# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Spend Pulse is a CLI tool (`spend-pulse`) that tracks credit card spending against a monthly budget and outputs structured YAML for AI assistants. Designed for the "AI runs this on cron" use case via [OpenClaw](https://openclaw.ai/) integration, not human dashboards. The core value is one number: pace (where you are vs. where you should be).

## Build & Test Commands

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript (tsc)
npm test                 # Run all tests (vitest)
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
npm link                 # Make spend-pulse available globally
```

Run a single test file:
```bash
npx vitest run tests/vault.test.ts
```

Run tests matching a pattern:
```bash
npx vitest run -t "getPreviousMonth"
```

## Architecture

### Data Flow

`spend-pulse sync` pulls from Plaid → stores in `~/.spend-pulse/data/YYYY-MM.yaml` → `spend-pulse check` computes pace against last month's curve → outputs `should_alert` + context as YAML → OpenClaw sends a message if needed.

### Module Structure

- **`src/vault.ts`** — The data layer. Reads/writes YAML files, computes summaries, builds cumulative spend curves. All file I/O and financial calculations live here. This is the largest module.
- **`src/types.ts`** — All TypeScript interfaces. Key types: `MonthlyData` (per-month transaction store), `Summary` (computed spending analysis), `CheckResult` (alert decision output), `Pace` (pace tracking with `source` indicating curve vs linear).
- **`src/commands/*.ts`** — Each CLI command is a Commander `Command` exported from its own file and registered in `src/index.ts`.
- **`src/lib/keychain.ts`** — Wraps `keytar` for macOS Keychain storage of Plaid credentials.
- **`src/lib/chart.ts`** — Renders a cumulative spending PNG chart via `chart.js` + `chartjs-node-canvas`.
- **`src/plaid.ts`** — Plaid SDK client wrapper.

### Pace System

Pace is computed against **last month's actual cumulative spend curve** when available, falling back to a linear ramp. This prevents false "over pace" alerts from recurring bills that hit early in the month.

Key functions in `vault.ts`:
- `buildCumulativeSpendCurve()` — builds a `Map<day, cumulativeTotal>` from a month's transactions
- `getExpectedSpendFromCurve()` — looks up expected spend for a given day, returns `{ expected, source }` where source is `'last_month'` or `'linear'`
- `computeSummaryFromMonthlyData()` — accepts an optional `lastMonthCurve` parameter

The `Pace` interface has a `source` field (`'last_month' | 'linear'`) that propagates through to `CheckResult.pace_source`.

### Data Storage

All data lives in `~/.spend-pulse/`. Config and transaction data are YAML files. Credentials are in macOS Keychain (never in files). Monthly transaction files are named `YYYY-MM.yaml`. There is a legacy `transactions.yaml` format that auto-migrates.

### Testing Patterns

Tests mock `keytar` (Keychain) since it requires macOS Keychain access:
```typescript
vi.mock('../src/lib/keychain.js', () => ({
  setPlaidCredentials: vi.fn(),
  // ...
}));
```

When no real transaction data exists, commands fall back to `getMockMonthlyData()` for demo purposes.

## Security

Plaid credentials (client_id, secret, access tokens) are stored in macOS Keychain via `keytar`, never in config files. Never commit `~/.spend-pulse/` contents or `.env` files.
