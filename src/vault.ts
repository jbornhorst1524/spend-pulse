import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import type { Config, TransactionsData, Summary, Settings, Transaction, SpendingStatus, PaceStatus, Pace, SyncResult } from './types.js';

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
      client_id: '',
      secret: '',
      access_token: '',
    },
    settings: {
      monthly_target: 8000,
      sync_days: 30,
      timezone: 'America/Chicago',
    },
  };
}

export function getTransactions(): TransactionsData | null {
  return readYaml<TransactionsData>(paths.transactions);
}

export function saveTransactions(data: TransactionsData): void {
  ensureVaultExists();
  writeYaml(paths.transactions, data);
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

export function computeSummary(transactions: TransactionsData, settings: Settings): Summary {
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

  // Calculate pace against linear ramp
  const expectedSpend = (dayOfMonth / daysInMonth) * settings.monthly_target;
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
