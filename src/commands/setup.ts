import { Command } from 'commander';
import http from 'http';
import open from 'open';
import prompts from 'prompts';
import { getConfigWithMigration, saveConfig, getDefaultConfig, ensureVaultExists, addPlaidItem, getPrimaryItem } from '../vault.js';
import { createPlaidClientWithCredentials, createLinkToken, exchangePublicToken } from '../plaid.js';
import { setPlaidCredentials, getPlaidCredentials, setAccessToken, deleteAccessToken, deleteAllCredentials } from '../lib/keychain.js';
import type { PlaidItem, PlaidMode } from '../types.js';

const PORT = 8234;

export const setupCommand = new Command('setup')
  .description('Connect your credit card via Plaid')
  .option('--client-id <id>', 'Plaid client ID (skip prompt)')
  .option('--secret <secret>', 'Plaid secret (skip prompt)')
  .option('--mode <mode>', 'Plaid mode: sandbox or development')
  .option('--upgrade', 'Upgrade from Sandbox to Development mode')
  .action(async (options) => {
    ensureVaultExists();

    // Handle upgrade flow
    if (options.upgrade) {
      await runUpgradeFlow();
      return;
    }

    // Check if already configured
    const existingConfig = await getConfigWithMigration();
    const existingCreds = await getPlaidCredentials();
    const hasExistingSetup = existingConfig && existingConfig.plaid.items.length > 0 && existingCreds;

    if (hasExistingSetup && !options.clientId && !options.secret) {
      const { action } = await prompts({
        type: 'select',
        name: 'action',
        message: 'Spend Pulse is already configured. What would you like to do?',
        choices: [
          { title: 'Add another card', value: 'add' },
          { title: 'Start fresh (reconfigure)', value: 'fresh' },
          { title: 'Cancel', value: 'cancel' },
        ],
      });

      if (action === 'cancel' || !action) {
        console.log('Setup cancelled.');
        return;
      }

      if (action === 'add') {
        await addAnotherCard(existingConfig!, existingCreds!);
        return;
      }
      // action === 'fresh' continues to full setup
    }

    await runFullSetup(options);
  });

async function runFullSetup(options: { clientId?: string; secret?: string; mode?: string }) {
  console.log('\n  Spend Pulse Setup\n');
  console.log('  This wizard will help you connect your credit card via Plaid.\n');

  // Step 1: Get Plaid credentials
  let clientId = options.clientId;
  let secret = options.secret;

  if (!clientId || !secret) {
    console.log('  Step 1: Plaid Credentials\n');
    console.log('  You need a Plaid account to connect your bank.');
    console.log('  Get your API keys at: https://dashboard.plaid.com/developers/keys\n');

    const existingCreds = await getPlaidCredentials();
    if (existingCreds && !clientId) {
      const { useExisting } = await prompts({
        type: 'confirm',
        name: 'useExisting',
        message: 'Found existing Plaid credentials in Keychain. Use them?',
        initial: true,
      });

      if (useExisting) {
        clientId = existingCreds.clientId;
        secret = existingCreds.secret;
      }
    }

    if (!clientId) {
      const response = await prompts({
        type: 'text',
        name: 'clientId',
        message: 'Plaid Client ID:',
        validate: (v) => v.length > 0 || 'Client ID is required',
      });
      clientId = response.clientId;
      if (!clientId) {
        console.log('Setup cancelled.');
        return;
      }
    }

    if (!secret) {
      const response = await prompts({
        type: 'password',
        name: 'secret',
        message: 'Plaid Secret:',
        validate: (v) => v.length > 0 || 'Secret is required',
      });
      secret = response.secret;
      if (!secret) {
        console.log('Setup cancelled.');
        return;
      }
    }
  }

  // Store credentials in keychain
  await setPlaidCredentials(clientId, secret);
  console.log('  Credentials saved to Keychain.\n');

  // Step 2: Choose mode
  let mode: PlaidMode = 'sandbox';
  if (options.mode === 'sandbox' || options.mode === 'development') {
    mode = options.mode;
  } else {
    console.log('  Step 2: Environment\n');
    const response = await prompts({
      type: 'select',
      name: 'mode',
      message: 'Which Plaid environment?',
      choices: [
        { title: 'Sandbox (test with fake data)', value: 'sandbox', description: 'Free, instant setup, fake transactions' },
        { title: 'Development (real bank connection)', value: 'development', description: 'Requires Plaid approval, 100 free items' },
      ],
      initial: 0,
    });
    mode = response.mode || 'sandbox';
  }

  // Step 3: Budget configuration
  console.log('\n  Step 3: Budget\n');
  const { budget } = await prompts({
    type: 'number',
    name: 'budget',
    message: 'Monthly spending budget ($):',
    initial: 8000,
    validate: (v) => v > 0 || 'Budget must be positive',
  });

  // Create config
  const config = getDefaultConfig();
  config.plaid.mode = mode;
  config.settings.monthly_target = budget || 8000;
  saveConfig(config);

  // Step 4: Connect bank via Plaid Link
  console.log('\n  Step 4: Connect Your Bank\n');
  if (mode === 'sandbox') {
    console.log('  In Sandbox mode, use these test credentials:');
    console.log('    Username: user_good');
    console.log('    Password: pass_good\n');
  }

  console.log('  Opening browser for Plaid Link...\n');

  try {
    const client = createPlaidClientWithCredentials(clientId, secret, mode);
    const linkToken = await createLinkToken(client, clientId);

    const { accessToken, itemId, institution, accounts } = await runLinkServer(linkToken, client);

    // Store access token in keychain
    await setAccessToken(itemId, accessToken);

    // Add item to config
    const plaidItem: PlaidItem = {
      item_id: itemId,
      institution,
      accounts,
    };
    addPlaidItem(config, plaidItem);
    saveConfig(config);

    // Step 5: Success
    console.log('\n  Setup Complete!\n');
    console.log(`  Institution: ${institution}`);
    console.log(`  Accounts: ${accounts.join(', ')}`);
    console.log(`  Budget: $${budget?.toLocaleString() || '8,000'}/month`);
    console.log(`  Mode: ${mode}\n`);

    console.log('  Next steps:');
    console.log('    spend-pulse sync     # Pull transactions');
    console.log('    spend-pulse status   # View spending summary');
    console.log('    spend-pulse check    # Check if alert needed\n');

    if (mode === 'sandbox') {
      console.log('  To use real bank data later:');
      console.log('    spend-pulse setup --upgrade\n');
    }
  } catch (error) {
    console.error('\n  Setup failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function addAnotherCard(config: Awaited<ReturnType<typeof getConfigWithMigration>>, creds: { clientId: string; secret: string }) {
  console.log('\n  Adding Another Card\n');

  try {
    const client = createPlaidClientWithCredentials(creds.clientId, creds.secret, config!.plaid.mode);
    const linkToken = await createLinkToken(client, creds.clientId);

    const { accessToken, itemId, institution, accounts } = await runLinkServer(linkToken, client);

    await setAccessToken(itemId, accessToken);

    const plaidItem: PlaidItem = {
      item_id: itemId,
      institution,
      accounts,
    };
    addPlaidItem(config!, plaidItem);
    saveConfig(config!);

    console.log('\n  Card Added!\n');
    console.log(`  Institution: ${institution}`);
    console.log(`  Accounts: ${accounts.join(', ')}\n`);
  } catch (error) {
    console.error('\n  Failed to add card:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function runUpgradeFlow() {
  console.log('\n  Upgrade to Development Mode\n');

  const config = await getConfigWithMigration();
  if (!config) {
    console.error('  Not configured. Run "spend-pulse setup" first.');
    process.exit(1);
  }

  if (config.plaid.mode === 'development') {
    console.log('  Already in Development mode.');
    return;
  }

  console.log('  This will:');
  console.log('    1. Switch to Development mode (real bank connections)');
  console.log('    2. Clear your Sandbox test data');
  console.log('    3. Let you connect real accounts\n');

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: 'Continue with upgrade?',
    initial: true,
  });

  if (!confirm) {
    console.log('  Upgrade cancelled.');
    return;
  }

  // Get new Development secret
  console.log('\n  Enter your Plaid Development credentials:');
  console.log('  (Find them at: https://dashboard.plaid.com/developers/keys)\n');

  const existingCreds = await getPlaidCredentials();

  const { clientId } = await prompts({
    type: 'text',
    name: 'clientId',
    message: 'Plaid Client ID:',
    initial: existingCreds?.clientId || '',
    validate: (v) => v.length > 0 || 'Client ID is required',
  });

  const { secret } = await prompts({
    type: 'password',
    name: 'secret',
    message: 'Plaid Development Secret:',
    validate: (v) => v.length > 0 || 'Secret is required',
  });

  if (!clientId || !secret) {
    console.log('  Upgrade cancelled.');
    return;
  }

  // Clear old sandbox data
  console.log('\n  Clearing Sandbox data...');
  for (const item of config.plaid.items) {
    await deleteAccessToken(item.item_id);
  }
  config.plaid.items = [];
  config.plaid.mode = 'development';

  // Store new credentials
  await setPlaidCredentials(clientId, secret);
  saveConfig(config);

  console.log('  Sandbox data cleared.\n');

  // Connect real bank
  console.log('  Now connect your real bank account...\n');

  try {
    const client = createPlaidClientWithCredentials(clientId, secret, 'development');
    const linkToken = await createLinkToken(client, clientId);

    const { accessToken, itemId, institution, accounts } = await runLinkServer(linkToken, client);

    await setAccessToken(itemId, accessToken);

    const plaidItem: PlaidItem = {
      item_id: itemId,
      institution,
      accounts,
    };
    addPlaidItem(config, plaidItem);
    saveConfig(config);

    console.log('\n  Upgrade Complete!\n');
    console.log(`  Mode: Development`);
    console.log(`  Institution: ${institution}`);
    console.log(`  Accounts: ${accounts.join(', ')}\n`);
    console.log('  Run "spend-pulse sync" to pull real transactions.\n');
  } catch (error) {
    console.error('\n  Upgrade failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

interface LinkResult {
  accessToken: string;
  itemId: string;
  institution: string;
  accounts: string[];
}

function runLinkServer(linkToken: string, client: ReturnType<typeof createPlaidClientWithCredentials>): Promise<LinkResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);

      if (url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getLinkHtml(linkToken));
      } else if (url.pathname === '/callback') {
        const publicToken = url.searchParams.get('public_token');
        const metadata = url.searchParams.get('metadata');

        if (!publicToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error: No public token received</h1>');
          return;
        }

        try {
          console.log('  Exchanging token...');
          const { accessToken, itemId } = await exchangePublicToken(client, publicToken);

          let institution = 'Unknown Institution';
          let accounts: string[] = [];
          if (metadata) {
            try {
              const meta = JSON.parse(decodeURIComponent(metadata));
              institution = meta.institution?.name || institution;
              accounts = meta.accounts?.map((a: any) => `${a.name} (...${a.mask})`) || [];
            } catch {
              // Metadata parsing failed, use defaults
            }
          }

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getSuccessHtml());

          setTimeout(() => {
            server.close();
            resolve({ accessToken, itemId, institution, accounts });
          }, 1000);
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<h1>Error exchanging token</h1><p>${error instanceof Error ? error.message : error}</p>`);
          server.close();
          reject(error);
        }
      } else if (url.pathname === '/exit') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h1>Setup cancelled</h1><p>You can close this window.</p>');
        server.close();
        reject(new Error('User cancelled setup'));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(PORT, () => {
      console.log(`  Browser opening at http://localhost:${PORT}`);
      open(`http://localhost:${PORT}`);
    });

    server.on('error', reject);
  });
}

function getLinkHtml(linkToken: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Connect Your Card - Spend Pulse</title>
  <script src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    h1 { color: #333; margin-bottom: 10px; }
    p { color: #666; margin-bottom: 30px; }
    button {
      background: #0066ff;
      color: white;
      border: none;
      padding: 14px 28px;
      font-size: 16px;
      border-radius: 8px;
      cursor: pointer;
    }
    button:hover { background: #0052cc; }
    .status { margin-top: 20px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Connect Your Card</h1>
    <p>Link your credit card to track spending.</p>
    <button id="link-btn">Connect with Plaid</button>
    <div id="status" class="status"></div>
  </div>
  <script>
    const handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: (publicToken, metadata) => {
        document.getElementById('status').textContent = 'Connecting...';
        const metaStr = encodeURIComponent(JSON.stringify(metadata));
        window.location.href = '/callback?public_token=' + encodeURIComponent(publicToken) + '&metadata=' + metaStr;
      },
      onExit: (err, metadata) => {
        if (err) {
          document.getElementById('status').textContent = 'Error: ' + err.display_message;
        } else {
          window.location.href = '/exit';
        }
      },
    });

    document.getElementById('link-btn').addEventListener('click', () => {
      handler.open();
    });
  </script>
</body>
</html>`;
}

function getSuccessHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Connected! - Spend Pulse</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #f5f5f5;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    }
    .checkmark { font-size: 64px; margin-bottom: 20px; }
    h1 { color: #333; }
    p { color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">&#10003;</div>
    <h1>Connected!</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;
}
