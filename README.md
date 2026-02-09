# spend-pulse

> Proactive spending alerts via Plaid. Set your budget, forget about it. Your AI texts you when you need to know.

Spend Pulse is a CLI tool that tracks credit card spending against a monthly budget. It's designed as an [OpenClaw](https://openclaw.ai/) skill—OpenClaw handles the cron scheduling and messaging, spend-pulse provides the data and alert decisions.

## How It Works

1. **You set a monthly budget** (e.g., $8,000)
2. **Plaid syncs your transactions** automatically
3. **OpenClaw runs `spend-pulse check`** on a schedule
4. **If noteworthy, you get a text** via iMessage, WhatsApp, or Telegram

The key insight: You don't need a dashboard. You need to know when you're off pace.

## Prerequisites

- **macOS** (required for Keychain credential storage and launchd scheduling)
- **Node.js >= 18**
- **Plaid developer account** (free sandbox mode available; production/development requires [Plaid approval](https://dashboard.plaid.com/))

## Installation

```bash
git clone https://github.com/jbornhorst1524/spend-pulse.git
cd spend-pulse
npm install && npm run build && npm link
```

Verify installation:
```bash
spend-pulse --version
```

## First-Time Setup

Run the interactive setup wizard:

```bash
spend-pulse setup
```

This will:
1. Prompt for Plaid API credentials (get them at https://dashboard.plaid.com/developers/keys)
2. Ask to choose Sandbox (test data) or Development (real bank) mode
3. Set monthly spending budget
4. Open browser for Plaid Link bank authentication
5. Store credentials securely in macOS Keychain

**For Sandbox testing**, use these Plaid test credentials when the bank login appears:
- Username: `user_good`
- Password: `pass_good`

After setup, run initial sync:
```bash
spend-pulse sync
```

## Commands

### `spend-pulse check` — Primary Command

Returns alert decision with full context for AI consumption.

```yaml
should_alert: true
reasons:
  - 3 new transactions
  - end of month approaching
month: "2026-01"
budget: 8000
spent: 6801.29
remaining: 1198.71
day_of_month: 30
days_in_month: 31
days_remaining: 1
expected_spend: 7200.00
pace: under
pace_delta: -398.71
pace_percent: -6
pace_source: last_month
oneline: "Jan: $6.8k of $8k (85%) | $1.2k left | 1 days | > On track"
new_transactions: 3
new_items:
  - merchant: Whole Foods
    amount: 47.50
    category: Groceries
```

Use `--chart` to also generate a spending chart PNG:
```bash
spend-pulse check --chart
# adds chart_path to YAML output
```

**Alert triggers** (`should_alert: true` when any apply):
- New transactions since last check
- Over pace (spending faster than expected)
- Remaining budget < $500
- End of month (last 3 days)
- First of month (new month started)

### `spend-pulse sync`

Pull latest transactions from Plaid. Run before `check` for fresh data.

```yaml
synced: 16
new: 3
account: "Amex Gold (...1234)"
total_this_month: 6801.29
```

**Scheduling options:**
```bash
spend-pulse sync --schedule daily      # Install daily sync at 9am
spend-pulse sync --schedule 18:00      # Or specific time
spend-pulse sync --status              # Check schedule status
spend-pulse sync --unschedule          # Remove schedule
```

### `spend-pulse status [--oneline]`

Full spending summary, or a quick one-liner:

```bash
spend-pulse status --oneline
# Jan: $6.8k of $8k (85%) | $1.2k left | 1 days | > On track
```

### `spend-pulse recent [--days N] [--count N]`

Recent transactions (default: last 5 days).

### `spend-pulse config [key] [value]`

View or modify settings:

```bash
spend-pulse config                  # show all
spend-pulse config target 8000      # set monthly budget
spend-pulse config timezone America/Chicago
```

### `spend-pulse chart [-o <path>]`

Generate a cumulative spending chart as a PNG image showing current month vs. last month vs. budget target.

```bash
spend-pulse chart                    # Writes to ~/.spend-pulse/chart.png
spend-pulse chart -o /tmp/chart.png  # Custom output path
```

### `spend-pulse link [--status] [--remove <id>]`

Manage linked bank accounts:

```bash
spend-pulse link --status    # show linked accounts
spend-pulse link             # add another account
spend-pulse link --remove <item_id>
```

## Upgrading to Real Bank Data

After testing with Sandbox, upgrade to Development mode for real transactions:

```bash
spend-pulse setup --upgrade
```

This clears sandbox data and connects your real bank account.

## Pace Tracking

Unlike simple threshold alerts ("you've spent 80%!"), spend-pulse paces against **last month's actual cumulative spend curve**:

- Day 15, last month you'd spent $4.2k by now → expected ~$4.2k
- Spent $3.5k? You're **under pace** — doing great.
- Spent $5k? You're **over pace** — heads up.

This means early-month bills (rent, subscriptions) won't trigger false alerts if you had similar bills last month. Falls back to a linear budget ramp when no prior month data exists. Check `pace_source` in the output to see which mode is active.

## Security

- Plaid credentials are stored in macOS Keychain (not config files)
- Access tokens are stored per-item in Keychain
- Config files contain only non-sensitive settings
- All sensitive data is excluded from git via .gitignore

## Data Storage

```
~/.spend-pulse/
├── config.yaml              # Budget, settings, linked account metadata
└── data/
    └── 2026-01.yaml         # Monthly transaction data
```

Monthly files contain:
```yaml
month: "2026-01"
last_sync: "2026-01-30T09:50:00Z"
last_check: "2026-01-28T18:00:00Z"
transactions:
  - id: "tx-123"
    date: "2026-01-15"
    amount: 125.50
    merchant: "Coffee Shop"
    category: "Food"
```

## OpenClaw Integration

Spend Pulse is designed as an [OpenClaw](https://openclaw.ai/) skill. See [SKILL.md](./SKILL.md) for the complete skill definition.

Typical OpenClaw workflow:
```bash
spend-pulse sync          # Pull latest from bank
spend-pulse check --chart # Get alert decision + chart image
# If should_alert: true → OpenClaw composes a message and attaches chart.png
```

## Tech Stack

- TypeScript / Node.js
- [Plaid](https://plaid.com/) for bank connectivity
- [keytar](https://github.com/atom/node-keytar) for secure credential storage
- [Commander](https://github.com/tj/commander.js) for CLI
- [prompts](https://github.com/terkelg/prompts) for interactive setup
- [js-yaml](https://github.com/nodeca/js-yaml) for data storage
- [chart.js](https://www.chartjs.org/) + [chartjs-node-canvas](https://github.com/SeanSobey/ChartjsNodeCanvas) for spending chart generation

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run test suite
npm link             # Make spend-pulse available globally
```

This is a personal project. Issues and feedback are welcome, but it's not actively seeking contributions.

## License

MIT
