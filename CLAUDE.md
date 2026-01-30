# CLAUDE.md - Spend Pulse

> Proactive spending alerts via Plaid. Set your budget, forget about it. Your AI texts you when you need to know.

## What This Is

Spend Pulse is a CLI tool (`spend-pulse`) that tracks credit card spending against a monthly budget and outputs structured data for AI assistants. It's designed for the "AI runs this on cron" use case, not the "human checks a dashboard" use case.

**Standalone CLI + OpenClaw Integration:** While spend-pulse works as a standalone CLI, its intended use is as an [OpenClaw](https://openclaw.ai/) skill. OpenClaw handles the cron scheduling, message composition, and delivery via iMessage/WhatsApp/Telegram—spend-pulse just provides the spending data and alert decisions.

**The key insight:** SpendSmart's value is one number—where you are vs. where you should be (pace). Everything else is gravy.

## Project Status

**Current:** Feature complete. Awaiting Plaid production approval, then QA and publish.

**Done:**
- Basic CLI structure (Commander)
- Plaid integration (setup, sync)
- YAML storage (`~/.spend-pulse/`)
- `spend-pulse check` with `should_alert` logic
- `spend-pulse status` and `spend-pulse status --oneline`
- `spend-pulse recent` command
- Pace calculation
- Secure credential storage (macOS Keychain via keytar)
- Guided onboarding wizard (`spend-pulse setup`)
- `spend-pulse setup --upgrade` for Sandbox → Development
- `spend-pulse link` command for multi-account management
- Monthly data files (2026-01.yaml format)
- Enhanced check output matching spec
- Launchd scheduling (`spend-pulse sync --schedule daily`)
- Unit and integration test suite (54 tests, vitest)
- package.json prepared for npm publish (files, engines, metadata)
- Sandbox testing complete
- OpenClaw integration validated (SKILL.md working)

**Next up:**
- Plaid production approval (pending)
- QA with real bank data
- Polish as needed
- Publish to GitHub (public), npm, and OpenClaw skill directory

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌─────────────┐
│    Plaid    │────▶│ spend-pulse  │────▶│  Local Data │────▶│  OpenClaw   │
│  (Bank API) │     │    (CLI)     │     │   (YAML)    │     │  (AI Agent) │
└─────────────┘     └──────────────┘     └─────────────┘     └─────────────┘
                           │                                       │
                           │         ┌─────────────────────────────┘
                           │         │
                           ▼         ▼
                 spend-pulse sync   OpenClaw cron
                    (daily)         (every 2 days → iMessage/WhatsApp)
```

**Flow:**
1. `spend-pulse sync` pulls transactions from Plaid (daily via launchd)
2. OpenClaw runs `spend-pulse check` on a cron schedule
3. If `should_alert: true`, OpenClaw composes and sends a message via your preferred channel
4. If `should_alert: false`, OpenClaw stays quiet

## Data Storage

```
~/.spend-pulse/
  config.yaml           # Budget, settings, Plaid item metadata (no credentials)
  data/
    2026-01.yaml        # Monthly transaction data
    summary.yaml        # Computed spending summary
    sync_result.yaml    # Last sync metadata
```

**Credentials:** Stored securely in macOS Keychain via `keytar`:
- `spend-pulse` → `plaid-client-id`
- `spend-pulse` → `plaid-secret`
- `spend-pulse` → `plaid-access-token-<item_id>`

## CLI Commands

| Command | Purpose |
|---------|---------|
| `spend-pulse check` | **Primary command.** Returns `should_alert` + full context for AI |
| `spend-pulse sync` | Pull latest transactions from Plaid |
| `spend-pulse sync --schedule daily` | Set up automated daily sync via launchd |
| `spend-pulse sync --status` | Show sync schedule status |
| `spend-pulse status` | Full spending summary as YAML |
| `spend-pulse status --oneline` | Quick one-liner summary |
| `spend-pulse recent [--days N]` | Recent transactions |
| `spend-pulse config [key] [value]` | View/set configuration |
| `spend-pulse setup` | Interactive setup wizard |
| `spend-pulse setup --upgrade` | Upgrade from Sandbox to Development mode |
| `spend-pulse link` | Add another bank account |
| `spend-pulse link --status` | Show linked accounts |
| `spend-pulse link --remove <id>` | Remove a linked account |

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point (Commander setup) |
| `src/vault.ts` | Data persistence, paths, summary computation, monthly files |
| `src/plaid.ts` | Plaid client wrapper |
| `src/types.ts` | TypeScript interfaces |
| `src/lib/keychain.ts` | Secure credential storage via keytar |
| `src/lib/scheduler.ts` | Launchd plist generation for automated sync |
| `src/commands/check.ts` | The money command—alert decision logic |
| `src/commands/sync.ts` | Plaid transaction sync + scheduling |
| `src/commands/setup.ts` | Interactive setup wizard |
| `src/commands/link.ts` | Multi-account management |
| `tests/` | Unit and integration tests (vitest) |
| `SKILL.md` | OpenClaw skill definition |

## Building & Running

```bash
npm install
npm run build        # Compile TypeScript
npm link             # Make spend-pulse available globally

spend-pulse --help   # Test it works
```

## Testing

```bash
npm test              # Run all tests (54 tests)
npm run test:watch    # Watch mode
npm run test:coverage # With coverage report
```

## Pace Calculation

The tool tracks spending against a **linear budget ramp**:

```typescript
expectedSpend = (dayOfMonth / daysInMonth) * monthlyTarget
paceDelta = actualSpend - expectedSpend
// Negative = under pace (good), Positive = over pace (concerning)
```

**Pace statuses:** `under` | `on_track` | `over`

## Alert Logic

`should_alert: true` when any of:
- New transactions since last check
- Over pace (spending faster than linear ramp)
- Remaining budget < $500
- End of month (last 3 days)
- First of month (fresh start)

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js
- **CLI:** Commander
- **Storage:** YAML (js-yaml)
- **Bank API:** Plaid (plaid-node SDK)
- **Credentials:** keytar (macOS Keychain)
- **Prompts:** prompts (interactive CLI)
- **Scheduling:** launchd (macOS)
- **Testing:** vitest

## OpenClaw Integration

Spend Pulse is designed as an OpenClaw skill. OpenClaw is an open-source personal AI assistant that:
- Runs locally on your machine
- Connects via iMessage, WhatsApp, Telegram, Discord, etc.
- Handles cron scheduling for periodic checks
- Composes natural language messages from structured data

See `SKILL.md` for the OpenClaw skill definition.

## Security

**Credentials are secure:**
- Plaid API keys stored in macOS Keychain (not files)
- Access tokens stored per-item in Keychain
- Config files contain no secrets
- Legacy configs auto-migrate to Keychain on first run

**Never commit:**
- `~/.spend-pulse/` contents
- `.env` files
- Any file with Plaid client_id, secret, or access_token values

## Full Spec

See `docs/spend-pulse-spec.md` for the complete product spec including:
- Detailed Plaid integration plans
- Keychain credential storage design
- Guided onboarding UX
- OpenClaw integration
- Distribution strategy
