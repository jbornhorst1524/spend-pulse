# CLAUDE.md - Spend Pulse

> Proactive spending alerts via Plaid. Set your budget, forget about it. Your AI texts you when you need to know.

## What This Is

Spend Pulse is a CLI tool (`spend-pulse`) that tracks credit card spending against a monthly budget and outputs structured data for AI assistants. It's designed for the "AI runs this on cron" use case, not the "human checks a dashboard" use case.

**Standalone CLI + OpenClaw Integration:** While spend-pulse works as a standalone CLI, its intended use is as an [OpenClaw](https://openclaw.ai/) skill. OpenClaw handles the cron scheduling, message composition, and delivery via iMessage/WhatsApp/Telegram—spend-pulse just provides the spending data and alert decisions.

**The key insight:** SpendSmart's value is one number—where you are vs. where you should be (pace). Everything else is gravy.

## Project Status

**Current:** Preparing for first public commit. Migrated from private spike project.

**Done:**
- Basic CLI structure (Commander)
- Plaid integration (setup, sync)
- YAML storage (`~/.spend-pulse/`)
- `spend-pulse check` with `should_alert` logic
- `spend-pulse status` and `spend-pulse status --oneline`
- `spend-pulse recent` command
- Pace calculation
- Renamed from `spend` to `spend-pulse`

**Next up (Phase 2):**
- Secure credential storage: Move Plaid keys from config.yaml to macOS Keychain
- Add `keytar` package for cross-platform keychain access
- Create `lib/keychain.ts` for credential operations
- Migration path for existing users

**Future (Phase 3-4):**
- Guided onboarding: `spend-pulse setup` with Sandbox-first flow
- `spend-pulse setup --upgrade` for Development tier
- Polish for npm publish
- Submit to OpenClaw skill directory

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
  config.yaml           # Budget, settings, Plaid metadata
  data/
    transactions.yaml   # All transactions
    summary.yaml        # Computed spending summary
    sync_result.yaml    # Last sync metadata
```

**IMPORTANT:** Currently Plaid credentials are in config.yaml. Phase 2 will move them to macOS Keychain for security before public release with real user data.

## CLI Commands

| Command | Purpose |
|---------|---------|
| `spend-pulse check` | **Primary command.** Returns `should_alert` + full context for AI |
| `spend-pulse sync` | Pull latest transactions from Plaid |
| `spend-pulse status` | Full spending summary as YAML |
| `spend-pulse status --oneline` | Quick one-liner summary |
| `spend-pulse recent [--days N]` | Recent transactions |
| `spend-pulse config [key] [value]` | View/set configuration |
| `spend-pulse setup` | Initial Plaid connection |

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point (Commander setup) |
| `src/vault.ts` | Data persistence, paths, summary computation |
| `src/plaid.ts` | Plaid client wrapper |
| `src/types.ts` | TypeScript interfaces |
| `src/commands/check.ts` | The money command—alert decision logic |
| `src/commands/sync.ts` | Plaid transaction sync |
| `src/commands/setup.ts` | Plaid Link auth flow |
| `SKILL.md` | OpenClaw skill definition |

## Building & Running

```bash
npm install
npm run build        # Compile TypeScript
npm link             # Make spend-pulse available globally

spend-pulse --help   # Test it works
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
- **Future:** keytar for Keychain, launchd for scheduling

## OpenClaw Integration

Spend Pulse is designed as an OpenClaw skill. OpenClaw is an open-source personal AI assistant that:
- Runs locally on your machine
- Connects via iMessage, WhatsApp, Telegram, Discord, etc.
- Handles cron scheduling for periodic checks
- Composes natural language messages from structured data

See `SKILL.md` for the OpenClaw skill definition.

## Security Notes

**For public release, we must ensure:**
1. No hardcoded credentials in code (verified clean)
2. `.gitignore` excludes all sensitive paths
3. Config files with secrets never committed
4. Future: Credentials in Keychain, not files

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
