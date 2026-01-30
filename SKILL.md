# Spend Pulse - OpenClaw Skill

> Proactive spending alerts via Plaid. Track credit card spending against a monthly budget with pace-based alerts.

## Overview

Spend Pulse is a CLI tool that tracks spending and tells you when to alert the user. It's designed for the "AI runs this on cron" pattern—you handle the scheduling and messaging, spend-pulse provides the data and alert decisions.

**Primary command:** `spend-pulse check`

## Requirements

```yaml
requires:
  bins: ["spend-pulse"]
```

Install via npm:
```bash
npm install -g spend-pulse
```

## Commands

### `spend-pulse check` (Primary)

Returns structured alert decision with all context needed. Use this as your main command.

```yaml
should_alert: true
reasons:
  - "3 new transactions since last check"
  - "Approaching end of month (1 day left)"

month: "2026-01"
budget: 8000
spent: 6801.29
remaining: 1198.71

pace: under
pace_delta: 940.65
pace_percent: -12

oneline: "Jan: $6.8k of $8k (85%) • $1.2k left • 1 day • ✓ Under pace"

new_transactions: 3
new_items:
  - merchant: "Whole Foods"
    amount: 47.50
    category: "Food & Drink"
  - merchant: "Amazon"
    amount: 125.00
    category: "Shopping"
```

**Alert logic:**
- `should_alert: true` if new transactions exist
- Also alerts if over pace, low remaining budget, or end of month

### `spend-pulse sync`

Pulls latest transactions from Plaid. Run before `check` for fresh data.

```yaml
synced: 16
new: 3
account: "Amex Gold (...1234)"
total_this_month: 4800.00
```

### `spend-pulse status`

Full spending summary. Use `--oneline` for a quick summary string.

```bash
spend-pulse status --oneline
# Output: "Jan: $6.8k of $8k (85%) • $1.2k left • 1 day • ✓ Under pace"
```

### `spend-pulse recent [--days N]`

Recent transactions (default: last 5 days).

### `spend-pulse config [key] [value]`

View or set configuration:
- `spend-pulse config` — show all
- `spend-pulse config budget 8000` — set monthly budget

## Usage Pattern

**Recommended workflow:**

```bash
spend-pulse sync       # Pull latest from Plaid
spend-pulse check      # Get alert decision + context
```

If `should_alert: true`, compose a brief, friendly spending update using the data provided.

If `should_alert: false`, stay quiet unless the user explicitly asks about spending.

## Alert Guidelines

- Use `oneline` as the core message
- Add context from `reasons` array
- Mention 1-2 notable transactions from `new_items` if interesting
- Keep messages under 280 characters when possible
- Tone: helpful friend, not nagging accountant

## Example Messages

**Under pace (positive):**
> "Quick pulse: Jan at $6.8k of $8k, $1.2k left with 1 day to go. Under pace by 12%—nice work!"

**On track:**
> "January update: $5,500 of $8k (69%) with 10 days left. Right on pace. Recent: $125 Amazon, $47 Whole Foods."

**Over pace (concerning):**
> "Heads up—January's at $7,200 of $8k with 5 days to go. About 10% over pace. The travel charges added up."

**Over budget:**
> "January budget update: $8,500 total, about $500 over the $8k target. Something to keep in mind for February."

## Cron Setup Example

Run every 2 days at 6pm:

```
0 18 */2 * *
```

Workflow:
1. Run `spend-pulse sync` to refresh data
2. Run `spend-pulse check` to get alert decision
3. If `should_alert: true`, compose and send message
4. If `should_alert: false`, do nothing

## Pace Explained

Spend Pulse tracks spending against a **linear budget ramp**:

- **expected**: Where you "should" be if spending evenly through the month
- **actual**: Where you are
- **pace_delta**: Difference (negative = under pace, positive = over)
- **pace**: `under` | `on_track` | `over`

This is more useful than simple threshold alerts because it accounts for where you are in the month.
