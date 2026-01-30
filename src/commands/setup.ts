import { Command } from 'commander';
import http from 'http';
import open from 'open';
import { getConfig, saveConfig, getDefaultConfig, ensureVaultExists } from '../vault.js';
import { createPlaidClient, createLinkToken, exchangePublicToken } from '../plaid.js';

const PORT = 8234;

export const setupCommand = new Command('setup')
  .description('Connect your Amex card via Plaid')
  .option('--client-id <id>', 'Plaid client ID')
  .option('--secret <secret>', 'Plaid secret')
  .action(async (options) => {
    ensureVaultExists();

    let config = getConfig() || getDefaultConfig();

    // Update credentials if provided
    if (options.clientId) {
      config.plaid.client_id = options.clientId;
    }
    if (options.secret) {
      config.plaid.secret = options.secret;
    }

    // Check for credentials
    if (!config.plaid.client_id || !config.plaid.secret) {
      console.error('Plaid credentials required. Either:');
      console.error('  1. Run: spend-pulse setup --client-id YOUR_ID --secret YOUR_SECRET');
      console.error('  2. Or edit ~/.spend-pulse/config.yaml directly');
      console.error('\nGet credentials at: https://dashboard.plaid.com/developers/keys');
      process.exit(1);
    }

    saveConfig(config);

    console.log('Starting Plaid Link...');

    try {
      const client = createPlaidClient(config);
      const linkToken = await createLinkToken(client, config.plaid.client_id);

      const accessToken = await runLinkServer(linkToken, client);

      config.plaid.access_token = accessToken;
      saveConfig(config);

      console.log('\n✓ Account connected successfully!');
      console.log('Run "spend-pulse sync" to pull transactions.');
    } catch (error) {
      console.error('Setup failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });

function runLinkServer(linkToken: string, client: ReturnType<typeof createPlaidClient>): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${PORT}`);

      if (url.pathname === '/') {
        // Serve the Plaid Link page
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getLinkHtml(linkToken));
      } else if (url.pathname === '/callback') {
        const publicToken = url.searchParams.get('public_token');

        if (!publicToken) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h1>Error: No public token received</h1>');
          return;
        }

        try {
          console.log('Exchanging token...');
          const accessToken = await exchangePublicToken(client, publicToken);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(getSuccessHtml());

          // Give browser time to load success page
          setTimeout(() => {
            server.close();
            resolve(accessToken);
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
      console.log(`Opening browser to http://localhost:${PORT}`);
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
    <p>Link your American Express card to track spending.</p>
    <button id="link-btn">Connect with Plaid</button>
    <div id="status" class="status"></div>
  </div>
  <script>
    const handler = Plaid.create({
      token: '${linkToken}',
      onSuccess: (publicToken, metadata) => {
        document.getElementById('status').textContent = 'Connecting...';
        window.location.href = '/callback?public_token=' + encodeURIComponent(publicToken);
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
    <div class="checkmark">✓</div>
    <h1>Connected!</h1>
    <p>You can close this window and return to the terminal.</p>
  </div>
</body>
</html>`;
}
