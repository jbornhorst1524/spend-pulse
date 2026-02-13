import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import type { Config, LegacyConfig, TransactionsData, MonthlyData, Summary, Settings, Transaction, SpendingStatus, PaceStatus, Pace, SyncResult, PlaidItem } from './types.js';
import { setPlaidCredentials, setAccessToken, getPlaidCredentials, getAccessToken } from './lib/keychain.js';

const VAULT_DIR = path.join(os.homedir(), '.spend-pulse');
const DATA_DIR = path.join(VAULT_DIR, 'data');

export const paths = {
  vault: VAULT_DIR,
  data: DATA_DIR,
  config: path.join(VAULT_DIR, 'config.yaml'),
  transactions: path.join(DATA_DIR, 'transactions.yaml'),
  summary: path.join(DATA_DIR, 'summary.yaml'),
  syncResult: path.join(DATA_DIR, 'sync_result.yaml'),
};

export function ensureVaultExists(): void {
  if (!fs.existsSync(VAULT_DIR)) {
    fs.mkdirSync(VAULT_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readYaml<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return yaml.load(content) as T;
}

export function writeYaml<T>(filePath: string, data: T): void {
  const content = yaml.dump(data, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
  });
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function getConfig(): Config | null {
  return readYaml<Config>(paths.config);
}

export function saveConfig(config: Config): void {
  ensureVaultExists();
  writeYaml(paths.config, config);
}

export function getDefaultConfig(): Config {
  return {
    plaid: {
      mode: 'sandbox',
      items: [],
    },
    settings: {
      monthly_target: 8000,
      sync_days: 30,
      timezone: 'America/Chicago',
    },
  };
}

/**
 * Check if a config object is in the legacy format (has credentials in plaid section)
 */
export function isLegacyConfig(config: Config | LegacyConfig): config is LegacyConfig {
  return 'client_id' in config.plaid || 'secret' in config.plaid || 'access_token' in config.plaid;
}

/**
 * Migrate legacy config to new format, moving credentials to keychain
 * Returns the migrated config (without credentials)
 */
export async function migrateConfig(legacyConfig: LegacyConfig): Promise<Config> {
  const { plaid: legacyPlaid, settings } = legacyConfig;

  // Store credentials in keychain if they exist
  if (legacyPlaid.client_id && legacyPlaid.secret) {
    await setPlaidCredentials(legacyPlaid.client_id, legacyPlaid.secret);
    console.log('Migrated Plaid credentials to Keychain');
  }

  // Create new config with default plaid settings
  const newConfig: Config = {
    plaid: {
      mode: 'sandbox',
      items: [],
    },
    settings,
  };

  // If there's an access token, we need to store it with a generated item_id
  // The actual item_id will be updated on next sync
  if (legacyPlaid.access_token) {
    const tempItemId = 'migrated-item';
    await setAccessToken(tempItemId, legacyPlaid.access_token);
    newConfig.plaid.items.push({
      item_id: tempItemId,
      institution: 'Unknown (migrated)',
      accounts: [],
    });
    console.log('Migrated access token to Keychain');
  }

  return newConfig;
}

/**
 * Get config, automatically migrating legacy format if detected
 */
export async function getConfigWithMigration(): Promise<Config | null> {
  const rawConfig = readYaml<Config | LegacyConfig>(paths.config);
  if (!rawConfig) {
    return null;
  }

  if (isLegacyConfig(rawConfig)) {
    console.log('Detected legacy config format, migrating...');
    const newConfig = await migrateConfig(rawConfig);
    saveConfig(newConfig);
    console.log('Config migration complete. Credentials are now stored securely in Keychain.');
    return newConfig;
  }

  return rawConfig;
}

/**
 * Add a Plaid item to the config
 */
export function addPlaidItem(config: Config, item: PlaidItem): void {
  // Remove any existing item with the same item_id
  config.plaid.items = config.plaid.items.filter(i => i.item_id !== item.item_id);
  config.plaid.items.push(item);
}

/**
 * Get the first/primary Plaid item (for single-account use cases)
 */
export function getPrimaryItem(config: Config): PlaidItem | null {
  return config.plaid.items[0] ?? null;
}

export function getTransactions(): TransactionsData | null {
  return readYaml<TransactionsData>(paths.transactions);
}

export function saveTransactions(data: TransactionsData): void {
  ensureVaultExists();
  writeYaml(paths.transactions, data);
}

// ============================================================================
// Monthly Data Files
// ============================================================================

/**
 * Get the path to a monthly data file
 * @param month - Month string in "YYYY-MM" format, e.g., "2026-01"
 */
export function getMonthlyDataPath(month: string): string {
  return path.join(DATA_DIR, `${month}.yaml`);
}

/**
 * Get the current month string in "YYYY-MM" format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Read monthly data for a specific month
 */
export function getMonthlyData(month: string): MonthlyData | null {
  const filePath = getMonthlyDataPath(month);
  return readYaml<MonthlyData>(filePath);
}

/**
 * Save monthly data for a specific month
 */
export function saveMonthlyData(data: MonthlyData): void {
  ensureVaultExists();
  const filePath = getMonthlyDataPath(data.month);
  writeYaml(filePath, data);
}

/**
 * Get or create monthly data for the current month
 */
export function getOrCreateCurrentMonthData(): MonthlyData {
  const month = getCurrentMonth();
  const existing = getMonthlyData(month);

  if (existing) {
    return existing;
  }

  // Check if there's legacy transactions.yaml data to migrate
  const legacyData = getTransactions();
  if (legacyData) {
    // Extract current month's transactions from legacy data
    const now = new Date();
    const year = now.getFullYear();
    const monthNum = now.getMonth();
    const startOfMonth = new Date(year, monthNum, 1);
    const endOfMonth = new Date(year, monthNum + 1, 0);
    const monthStart = startOfMonth.toISOString().split('T')[0];
    const monthEnd = endOfMonth.toISOString().split('T')[0];

    const monthlyTransactions = legacyData.transactions.filter(t => {
      return t.date >= monthStart && t.date <= monthEnd;
    });

    const newData: MonthlyData = {
      month,
      last_sync: legacyData.last_sync,
      transactions: monthlyTransactions,
    };

    saveMonthlyData(newData);
    console.log(`Migrated ${monthlyTransactions.length} transactions to monthly file ${month}.yaml`);
    return newData;
  }

  // Create empty monthly data
  return {
    month,
    last_sync: new Date().toISOString(),
    transactions: [],
  };
}

/**
 * Add transactions to monthly data, deduplicating by transaction ID
 * Also handles pending→posted transitions using pending_transaction_id
 */
export function addTransactionsToMonthlyData(
  monthlyData: MonthlyData,
  newTransactions: Transaction[]
): { added: number; updated: MonthlyData } {
  const existingIds = new Set(monthlyData.transactions.map(t => t.id));
  
  // Find pending transaction IDs that are being replaced by posted versions
  const pendingIdsToRemove = new Set<string>();
  for (const t of newTransactions) {
    if (t.pending_transaction_id && !t.pending) {
      // This is a posted transaction that replaces a pending one
      pendingIdsToRemove.add(t.pending_transaction_id);
    }
  }
  
  // Filter out pending transactions that are being replaced
  const existingFiltered = monthlyData.transactions.filter(t => !pendingIdsToRemove.has(t.id));
  
  // Update existingIds to reflect removals
  const filteredIds = new Set(existingFiltered.map(t => t.id));
  
  // Add new transactions that aren't already present
  const toAdd = newTransactions.filter(t => !filteredIds.has(t.id));

  const updated: MonthlyData = {
    ...monthlyData,
    last_sync: new Date().toISOString(),
    transactions: [
      ...existingFiltered,
      ...toAdd,
    ].sort((a, b) => b.date.localeCompare(a.date)),
  };

  const removed = monthlyData.transactions.length - existingFiltered.length;
  return { added: toAdd.length - removed, updated };
}

/**
 * Update the last_check timestamp in monthly data
 */
export function updateMonthlyLastCheck(month: string): void {
  const data = getMonthlyData(month);
  if (data) {
    data.last_check = new Date().toISOString();
    saveMonthlyData(data);
  }
}

/**
 * Get transactions added since last check
 */
export function getNewTransactionsSinceLastCheck(monthlyData: MonthlyData): Transaction[] {
  if (!monthlyData.last_check) {
    // No previous check, return all transactions
    return monthlyData.transactions;
  }

  const lastCheckDate = new Date(monthlyData.last_check);
  const lastSyncDate = new Date(monthlyData.last_sync);

  // If last_sync is newer than last_check, there might be new transactions
  if (lastSyncDate > lastCheckDate) {
    // We can't know exactly which transactions are new without tracking them
    // So we'll return transactions from the sync that happened after last check
    // For now, return empty - the sync command will track new IDs separately
    return [];
  }

  return [];
}

/**
 * Get the previous month string in "YYYY-MM" format
 * Handles year wrap (e.g., 2026-01 → 2025-12)
 */
export function getPreviousMonth(month?: string): string {
  const ref = month ?? getCurrentMonth();
  const [year, mon] = ref.split('-').map(Number);
  if (mon === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${(mon - 1).toString().padStart(2, '0')}`;
}

/**
 * Build a day-by-day cumulative spend map from a month's transactions.
 * Days with no transactions carry forward the previous day's value (step function).
 */
export function buildCumulativeSpendCurve(monthlyData: MonthlyData): Map<number, number> {
  const [year, monthNum] = monthlyData.month.split('-').map(Number);
  const daysInMonth = new Date(year, monthNum, 0).getDate();

  // Group transaction amounts by day-of-month
  const dailySpend = new Map<number, number>();
  for (const t of monthlyData.transactions) {
    const day = parseInt(t.date.split('-')[2], 10);
    dailySpend.set(day, (dailySpend.get(day) ?? 0) + t.amount);
  }

  // Walk day 1→N accumulating a running total
  const curve = new Map<number, number>();
  let running = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    running += dailySpend.get(d) ?? 0;
    curve.set(d, Math.round(running * 100) / 100);
  }

  return curve;
}

/**
 * Get expected spend for the current day from last month's curve.
 * Falls back to linear ramp if curve is null/empty.
 */
export function getExpectedSpendFromCurve(
  dayOfMonth: number,
  daysInCurrentMonth: number,
  lastMonthCurve: Map<number, number> | null,
  monthlyTarget: number,
): { expected: number; source: 'last_month' | 'linear' } {
  // Fall back to linear ramp if no curve data
  if (!lastMonthCurve || lastMonthCurve.size === 0) {
    return {
      expected: (dayOfMonth / daysInCurrentMonth) * monthlyTarget,
      source: 'linear',
    };
  }

  // If day exists in curve, use it
  if (lastMonthCurve.has(dayOfMonth)) {
    return {
      expected: lastMonthCurve.get(dayOfMonth)!,
      source: 'last_month',
    };
  }

  // If current month is longer than last month, cap at last month's final total
  const maxDay = Math.max(...lastMonthCurve.keys());
  if (dayOfMonth > maxDay) {
    return {
      expected: lastMonthCurve.get(maxDay)!,
      source: 'last_month',
    };
  }

  // Should not happen since curve is built for all days, but fallback
  return {
    expected: (dayOfMonth / daysInCurrentMonth) * monthlyTarget,
    source: 'linear',
  };
}

/**
 * Compute summary from monthly data
 */
export function computeSummaryFromMonthlyData(monthlyData: MonthlyData, settings: Settings, lastMonthCurve?: Map<number, number> | null): Summary {
  const now = new Date();
  const [year, monthNum] = monthlyData.month.split('-').map(Number);

  const startOfMonth = new Date(year, monthNum - 1, 1);
  const endOfMonth = new Date(year, monthNum, 0);
  const daysInMonth = endOfMonth.getDate();
  const dayOfMonth = now.getMonth() + 1 === monthNum && now.getFullYear() === year
    ? now.getDate()
    : daysInMonth;
  const daysRemaining = daysInMonth - dayOfMonth;

  const monthStart = startOfMonth.toISOString().split('T')[0];
  const monthEnd = endOfMonth.toISOString().split('T')[0];

  const transactions = monthlyData.transactions;

  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
  const remaining = settings.monthly_target - total;
  const percentUsed = (total / settings.monthly_target) * 100;
  const dailyAverage = dayOfMonth > 0 ? total / dayOfMonth : 0;

  // Calculate pace against last month's curve (or linear ramp fallback)
  const { expected: expectedSpend, source: paceSource } = getExpectedSpendFromCurve(
    dayOfMonth, daysInMonth, lastMonthCurve ?? null, settings.monthly_target,
  );
  const paceDiff = total - expectedSpend;
  const pacePercentDiff = expectedSpend > 0 ? (paceDiff / expectedSpend) * 100 : 0;

  let paceStatus: PaceStatus = 'on_pace';
  if (paceDiff < -expectedSpend * 0.05) {
    paceStatus = 'ahead';
  } else if (paceDiff > expectedSpend * 0.05) {
    paceStatus = 'behind';
  }

  const pace: Pace = {
    expected: Math.round(expectedSpend * 100) / 100,
    actual: Math.round(total * 100) / 100,
    diff: Math.round(paceDiff * 100) / 100,
    status: paceStatus,
    percent_diff: Math.round(pacePercentDiff * 10) / 10,
    source: paceSource,
  };

  // Determine status
  let status: SpendingStatus = 'on_track';
  if (total > settings.monthly_target) {
    status = 'over';
  } else if (percentUsed > (dayOfMonth / daysInMonth) * 100 + 10) {
    status = 'watch';
  }

  // Category totals
  const categoryMap = new Map<string, number>();
  for (const t of transactions) {
    const current = categoryMap.get(t.category) || 0;
    categoryMap.set(t.category, current + t.amount);
  }
  const topCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Recent transactions
  const recentTransactions = [...transactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(t => ({
      date: t.date,
      merchant: t.merchant,
      amount: t.amount,
    }));

  return {
    computed_at: now.toISOString(),
    period: {
      start: monthStart,
      end: monthEnd,
      days_elapsed: dayOfMonth,
      days_remaining: daysRemaining,
    },
    spending: {
      total: Math.round(total * 100) / 100,
      target: settings.monthly_target,
      remaining: Math.round(remaining * 100) / 100,
      percent_used: Math.round(percentUsed * 10) / 10,
      daily_average: Math.round(dailyAverage * 100) / 100,
      projected_total: Math.round(total * 100) / 100,
    },
    pace,
    status,
    top_categories: topCategories,
    recent_transactions: recentTransactions,
  };
}

/**
 * Get mock monthly data for testing
 */
export function getMockMonthlyData(): MonthlyData {
  const now = new Date();
  const month = getCurrentMonth();
  const year = now.getFullYear();
  const monthNum = now.getMonth();

  const mockTransactions: Transaction[] = [
    { id: 'mock_001', date: formatDate(new Date(year, monthNum, now.getDate())), amount: 47.50, merchant: 'Whole Foods Market', category: 'Groceries' },
    { id: 'mock_002', date: formatDate(new Date(year, monthNum, now.getDate() - 1)), amount: 125.00, merchant: 'Amazon', category: 'Shopping' },
    { id: 'mock_003', date: formatDate(new Date(year, monthNum, now.getDate() - 1)), amount: 85.00, merchant: 'Shell Gas Station', category: 'Gas' },
    { id: 'mock_004', date: formatDate(new Date(year, monthNum, now.getDate() - 2)), amount: 156.78, merchant: 'Target', category: 'Shopping' },
    { id: 'mock_005', date: formatDate(new Date(year, monthNum, now.getDate() - 3)), amount: 42.00, merchant: 'Chipotle', category: 'Restaurants' },
    { id: 'mock_006', date: formatDate(new Date(year, monthNum, now.getDate() - 4)), amount: 89.50, merchant: 'Costco', category: 'Groceries' },
    { id: 'mock_007', date: formatDate(new Date(year, monthNum, now.getDate() - 5)), amount: 220.00, merchant: 'Best Buy', category: 'Electronics' },
    { id: 'mock_008', date: formatDate(new Date(year, monthNum, now.getDate() - 6)), amount: 35.00, merchant: 'Uber Eats', category: 'Restaurants' },
    { id: 'mock_009', date: formatDate(new Date(year, monthNum, now.getDate() - 7)), amount: 1200.00, merchant: 'United Airlines', category: 'Travel' },
    { id: 'mock_010', date: formatDate(new Date(year, monthNum, now.getDate() - 8)), amount: 450.00, merchant: 'Hilton Hotels', category: 'Travel' },
    { id: 'mock_011', date: formatDate(new Date(year, monthNum, now.getDate() - 10)), amount: 175.00, merchant: 'Trader Joes', category: 'Groceries' },
    { id: 'mock_012', date: formatDate(new Date(year, monthNum, now.getDate() - 12)), amount: 65.00, merchant: 'The Cheesecake Factory', category: 'Restaurants' },
    { id: 'mock_013', date: formatDate(new Date(year, monthNum, now.getDate() - 14)), amount: 890.00, merchant: 'Apple Store', category: 'Electronics' },
    { id: 'mock_014', date: formatDate(new Date(year, monthNum, now.getDate() - 16)), amount: 55.00, merchant: 'CVS Pharmacy', category: 'Healthcare' },
    { id: 'mock_015', date: formatDate(new Date(year, monthNum, now.getDate() - 18)), amount: 320.00, merchant: 'Nordstrom', category: 'Shopping' },
    { id: 'mock_016', date: formatDate(new Date(year, monthNum, now.getDate() - 20)), amount: 95.00, merchant: 'HEB', category: 'Groceries' },
    { id: 'mock_017', date: formatDate(new Date(year, monthNum, now.getDate() - 22)), amount: 78.00, merchant: 'Netflix + Spotify + Apple', category: 'Subscriptions' },
    { id: 'mock_018', date: formatDate(new Date(year, monthNum, now.getDate() - 24)), amount: 2500.00, merchant: 'Renovation Depot', category: 'Home' },
  ];

  // Filter to only include transactions with valid dates in current month
  const startOfMonth = new Date(year, monthNum, 1);
  const validTransactions = mockTransactions.filter(t => {
    const tDate = new Date(t.date);
    return tDate >= startOfMonth && tDate <= now;
  });

  return {
    month,
    last_sync: now.toISOString(),
    transactions: validTransactions,
  };
}

export function getSummary(): Summary | null {
  return readYaml<Summary>(paths.summary);
}

export function saveSummary(summary: Summary): void {
  ensureVaultExists();
  writeYaml(paths.summary, summary);
}

export function getSyncResult(): SyncResult | null {
  return readYaml<SyncResult>(paths.syncResult);
}

export function saveSyncResult(result: SyncResult): void {
  ensureVaultExists();
  writeYaml(paths.syncResult, result);
}

export function computeSummary(transactions: TransactionsData, settings: Settings, lastMonthCurve?: Map<number, number> | null): Summary {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const startOfMonth = new Date(year, month, 1);
  const endOfMonth = new Date(year, month + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  // Filter transactions to current month
  const monthStart = startOfMonth.toISOString().split('T')[0];
  const monthEnd = endOfMonth.toISOString().split('T')[0];

  const monthlyTransactions = transactions.transactions.filter(t => {
    return t.date >= monthStart && t.date <= monthEnd;
  });

  const total = monthlyTransactions.reduce((sum, t) => sum + t.amount, 0);
  const remaining = settings.monthly_target - total;
  const percentUsed = (total / settings.monthly_target) * 100;
  const dailyAverage = dayOfMonth > 0 ? total / dayOfMonth : 0;

  // Calculate pace against last month's curve (or linear ramp fallback)
  const { expected: expectedSpend, source: paceSource } = getExpectedSpendFromCurve(
    dayOfMonth, daysInMonth, lastMonthCurve ?? null, settings.monthly_target,
  );
  const paceDiff = total - expectedSpend;
  const pacePercentDiff = expectedSpend > 0 ? (paceDiff / expectedSpend) * 100 : 0;

  let paceStatus: PaceStatus = 'on_pace';
  if (paceDiff < -expectedSpend * 0.05) {
    paceStatus = 'ahead';
  } else if (paceDiff > expectedSpend * 0.05) {
    paceStatus = 'behind';
  }

  const pace: Pace = {
    expected: Math.round(expectedSpend * 100) / 100,
    actual: Math.round(total * 100) / 100,
    diff: Math.round(paceDiff * 100) / 100,
    status: paceStatus,
    percent_diff: Math.round(pacePercentDiff * 10) / 10,
    source: paceSource,
  };

  // Determine status
  let status: SpendingStatus = 'on_track';
  if (total > settings.monthly_target) {
    status = 'over';
  } else if (percentUsed > (dayOfMonth / daysInMonth) * 100 + 10) {
    status = 'watch';
  }

  // Category totals
  const categoryMap = new Map<string, number>();
  for (const t of monthlyTransactions) {
    const current = categoryMap.get(t.category) || 0;
    categoryMap.set(t.category, current + t.amount);
  }
  const topCategories = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // Recent transactions
  const recentTransactions = [...monthlyTransactions]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map(t => ({
      date: t.date,
      merchant: t.merchant,
      amount: t.amount,
    }));

  return {
    computed_at: now.toISOString(),
    period: {
      start: monthStart,
      end: monthEnd,
      days_elapsed: dayOfMonth,
      days_remaining: daysRemaining,
    },
    spending: {
      total: Math.round(total * 100) / 100,
      target: settings.monthly_target,
      remaining: Math.round(remaining * 100) / 100,
      percent_used: Math.round(percentUsed * 10) / 10,
      daily_average: Math.round(dailyAverage * 100) / 100,
      projected_total: Math.round(total * 100) / 100,
    },
    pace,
    status,
    top_categories: topCategories,
    recent_transactions: recentTransactions,
  };
}

export function getMockTransactions(): TransactionsData {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const mockTransactions: Transaction[] = [
    { id: 'mock_001', date: formatDate(new Date(year, month, now.getDate())), amount: 47.50, merchant: 'Whole Foods Market', category: 'Groceries' },
    { id: 'mock_002', date: formatDate(new Date(year, month, now.getDate() - 1)), amount: 125.00, merchant: 'Amazon', category: 'Shopping' },
    { id: 'mock_003', date: formatDate(new Date(year, month, now.getDate() - 1)), amount: 85.00, merchant: 'Shell Gas Station', category: 'Gas' },
    { id: 'mock_004', date: formatDate(new Date(year, month, now.getDate() - 2)), amount: 156.78, merchant: 'Target', category: 'Shopping' },
    { id: 'mock_005', date: formatDate(new Date(year, month, now.getDate() - 3)), amount: 42.00, merchant: 'Chipotle', category: 'Restaurants' },
    { id: 'mock_006', date: formatDate(new Date(year, month, now.getDate() - 4)), amount: 89.50, merchant: 'Costco', category: 'Groceries' },
    { id: 'mock_007', date: formatDate(new Date(year, month, now.getDate() - 5)), amount: 220.00, merchant: 'Best Buy', category: 'Electronics' },
    { id: 'mock_008', date: formatDate(new Date(year, month, now.getDate() - 6)), amount: 35.00, merchant: 'Uber Eats', category: 'Restaurants' },
    { id: 'mock_009', date: formatDate(new Date(year, month, now.getDate() - 7)), amount: 1200.00, merchant: 'United Airlines', category: 'Travel' },
    { id: 'mock_010', date: formatDate(new Date(year, month, now.getDate() - 8)), amount: 450.00, merchant: 'Hilton Hotels', category: 'Travel' },
    { id: 'mock_011', date: formatDate(new Date(year, month, now.getDate() - 10)), amount: 175.00, merchant: 'Trader Joes', category: 'Groceries' },
    { id: 'mock_012', date: formatDate(new Date(year, month, now.getDate() - 12)), amount: 65.00, merchant: 'The Cheesecake Factory', category: 'Restaurants' },
    { id: 'mock_013', date: formatDate(new Date(year, month, now.getDate() - 14)), amount: 890.00, merchant: 'Apple Store', category: 'Electronics' },
    { id: 'mock_014', date: formatDate(new Date(year, month, now.getDate() - 16)), amount: 55.00, merchant: 'CVS Pharmacy', category: 'Healthcare' },
    { id: 'mock_015', date: formatDate(new Date(year, month, now.getDate() - 18)), amount: 320.00, merchant: 'Nordstrom', category: 'Shopping' },
    { id: 'mock_016', date: formatDate(new Date(year, month, now.getDate() - 20)), amount: 95.00, merchant: 'HEB', category: 'Groceries' },
    { id: 'mock_017', date: formatDate(new Date(year, month, now.getDate() - 22)), amount: 78.00, merchant: 'Netflix + Spotify + Apple', category: 'Subscriptions' },
    { id: 'mock_018', date: formatDate(new Date(year, month, now.getDate() - 24)), amount: 2500.00, merchant: 'Renovation Depot', category: 'Home' },
  ];

  // Filter to only include transactions with valid dates in current month
  const startOfMonth = new Date(year, month, 1);
  const validTransactions = mockTransactions.filter(t => {
    const tDate = new Date(t.date);
    return tDate >= startOfMonth && tDate <= now;
  });

  return {
    last_sync: now.toISOString(),
    account: {
      name: 'Amex Platinum',
      mask: '1234',
    },
    transactions: validTransactions,
  };
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
