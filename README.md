# spend-pulse

> Proactive spending alerts via Plaid. Set your budget, forget about it. Your AI texts you when you need to know.

Spend Pulse is a CLI tool that tracks credit card spending against a monthly budget. It's designed as an [OpenClaw](https://openclaw.ai/) skill—OpenClaw handles the cron scheduling and messaging, spend-pulse provides the data and alert decisions.

## How It Works

1. **You set a monthly budget** (e.g., $8,000)
2. **Plaid syncs your transactions** automatically
3. **OpenClaw runs `spend-pulse check`** on a schedule
4. **If noteworthy, you get a text** via iMessage, WhatsApp, or Telegram

The key insight: You don't need a dashboard. You need to know when you're off pace.

## Installation

```bash
npm install -g spend-pulse
```

Or from source:

```bash
git clone https://github.com/jbornhorst1524/spend-pulse.git
cd spend-pulse
npm install
npm run build
npm link
```

## Setup

1. Get Plaid credentials at https://dashboard.plaid.com/developers/keys
2. Connect your card:

```bash
spend-pulse setup --client-id YOUR_CLIENT_ID --secret YOUR_SECRET
```

This opens a browser to authenticate with your bank via Plaid Link.

## Commands

### `spend-pulse check`

The primary command. Returns alert decision with full context for AI consumption.

```yaml
should_alert: true
reasons:
  - "3 new transactions since last check"
pace: under
pace_delta: -361.29
oneline: "Jan: $4.8k of $8k (60%) • $3.2k left • 15 days • ✓ Under pace"
new_items:
  - merchant: Whole Foods
    amount: 47.50
```

### `spend-pulse sync`

Pull latest transactions from Plaid.

### `spend-pulse status [--oneline]`

Full spending summary, or a quick one-liner:

```
Jan: $4.8k of $8k (60%) • $3.2k left • 15 days • ✓ Under pace
```

### `spend-pulse recent [--days N]`

Recent transactions (default: last 5 days).

### `spend-pulse config [key] [value]`

View or set configuration:

```bash
spend-pulse config                 # show all
spend-pulse config budget 8000     # set monthly budget
```

## Pace Tracking

Unlike simple threshold alerts ("you've spent 80%!"), spend-pulse tracks against a **linear budget ramp**:

- Day 15 of 30? You should have spent ~50% of budget.
- Spent 40%? You're **under pace**—doing great.
- Spent 60%? You're **over pace**—heads up.

This is the core insight from Amex SpendSmart, now available for AI consumption.

## Data Storage

```
~/.spend-pulse/
├── config.yaml              # Budget, settings
└── data/
    ├── transactions.yaml    # Transaction log
    ├── summary.yaml         # Computed summary
    └── sync_result.yaml     # Last sync metadata
```

## OpenClaw Integration

Spend Pulse is designed as an [OpenClaw](https://openclaw.ai/) skill. See [SKILL.md](./SKILL.md) for the skill definition.

Typical OpenClaw workflow:
```bash
spend-pulse sync    # Pull latest from bank
spend-pulse check   # Get alert decision
# If should_alert: true → OpenClaw sends you a message
```

## Tech Stack

- TypeScript / Node.js
- [Plaid](https://plaid.com/) for bank connectivity
- [Commander](https://github.com/tj/commander.js) for CLI
- [js-yaml](https://github.com/nodeca/js-yaml) for data storage

## License

MIT
