import { Command } from 'commander';
import http from 'http';
import open from 'open';
import prompts from 'prompts';
import yaml from 'js-yaml';
import { getConfigWithMigration, saveConfig, ensureVaultExists, addPlaidItem } from '../vault.js';
import { createPlaidClientWithCredentials, createLinkToken, exchangePublicToken } from '../plaid.js';
import { getPlaidCredentials, setAccessToken, deleteAccessToken } from '../lib/keychain.js';
import type { PlaidItem } from '../types.js';

const PORT = 8234;

export const linkCommand = new Command('link')
  .description('Manage linked bank accounts')
  .option('--status', 'Show currently linked accounts')
  .option('--remove <item_id>', 'Remove a linked account')
  .action(async (options) => {
    ensureVaultExists();

    const config = await getConfigWithMigration();
    if (!config) {
      console.error('Not configured. Run "spend-pulse setup" first.');
      process.exit(1);
    }

    // Show status
    if (options.status) {
      await showStatus(config);
      return;
    }

    // Remove an account
    if (options.remove) {
      await removeAccount(config, options.remove);
      return;
    }

    // Default: add another account
    await addAccount(config);
  });

async function showStatus(config: NonNullable<Awaited<ReturnType<typeof getConfigWithMigration>>>) {
  console.log('\n  Linked Accounts\n');

  if (config.plaid.items.length === 0) {
    console.log('  No accounts linked yet.');
    console.log('  Run "spend-pulse setup" to connect your first account.\n');
    return;
  }

  console.log(`  Mode: ${config.plaid.mode}\n`);

  for (const item of config.plaid.items) {
    console.log(`  ${item.institution}`);
    console.log(`    ID: ${item.item_id}`);
    if (item.accounts.length > 0) {
      console.log(`    Accounts: ${item.accounts.join(', ')}`);
    }
    console.log('');
  }

  console.log(`  Total: ${config.plaid.items.length} linked account(s)\n`);

  // Also output as YAML for machine consumption
  const output = {
    mode: config.plaid.mode,
    items: config.plaid.items.map(item => ({
      item_id: item.item_id,
      institution: item.institution,
      accounts: item.accounts,
    })),
    total: config.plaid.items.length,
  };
  console.log(yaml.dump(output, { lineWidth: -1 }));
}

async function removeAccount(config: NonNullable<Awaited<ReturnType<typeof getConfigWithMigration>>>, itemId: string) {
  const item = config.plaid.items.find(i => i.item_id === itemId);

  if (!item) {
    console.error(`Account with ID "${itemId}" not found.`);
    console.log('\nLinked accounts:');
    for (const i of config.plaid.items) {
      console.log(`  ${i.item_id} - ${i.institution}`);
    }
    process.exit(1);
  }

  const { confirm } = await prompts({
    type: 'confirm',
    name: 'confirm',
    message: `Remove ${item.institution}?`,
    initial: false,
  });

  if (!confirm) {
    console.log('Cancelled.');
    return;
  }

  // Remove from keychain
  await deleteAccessToken(itemId);

  // Remove from config
  config.plaid.items = config.plaid.items.filter(i => i.item_id !== itemId);
  saveConfig(config);

  console.log(`\nRemoved ${item.institution}.`);

  if (config.plaid.items.length === 0) {
    console.log('No accounts remaining. Run "spend-pulse setup" to link a new account.\n');
  }
}

async function addAccount(config: NonNullable<Awaited<ReturnType<typeof getConfigWithMigration>>>) {
  const creds = await getPlaidCredentials();
  if (!creds) {
    console.error('Plaid credentials not found. Run "spend-pulse setup" first.');
    process.exit(1);
  }

  console.log('\n  Link Another Account\n');

  try {
    const client = createPlaidClientWithCredentials(creds.clientId, creds.secret, config.plaid.mode);
    const linkToken = await createLinkToken(client, creds.clientId);

    if (config.plaid.mode === 'sandbox') {
      console.log('  In Sandbox mode, use these test credentials:');
      console.log('    Username: user_good');
      console.log('    Password: pass_good\n');
    }

    console.log('  Opening browser for Plaid Link...\n');

    const { accessToken, itemId, institution, accounts } = await runLinkServer(linkToken, client);

    await setAccessToken(itemId, accessToken);

    const plaidItem: PlaidItem = {
      item_id: itemId,
      institution,
      accounts,
    };
    addPlaidItem(config, plaidItem);
    saveConfig(config);

    console.log('\n  Account Linked!\n');
    console.log(`  Institution: ${institution}`);
    console.log(`  Accounts: ${accounts.join(', ')}`);
    console.log(`\n  Total linked accounts: ${config.plaid.items.length}\n`);
  } catch (error) {
    console.error('\n  Failed to link account:', error instanceof Error ? error.message : error);
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
        res.end('<h1>Link cancelled</h1><p>You can close this window.</p>');
        server.close();
        reject(new Error('User cancelled link'));
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
  <title>Link Account - Spend Pulse</title>
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
    <h1>Link Another Account</h1>
    <p>Connect an additional credit card to track spending.</p>
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
  <title>Linked! - Spend Pulse</title>
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
    <h1>Account Linked!</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;
}
