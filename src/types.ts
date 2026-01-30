export interface PlaidConfig {
  client_id: string;
  secret: string;
  access_token: string;
}

export interface Settings {
  monthly_target: number;
  sync_days: number;
  timezone: string;
}

export interface Config {
  plaid: PlaidConfig;
  settings: Settings;
}

export interface Account {
  name: string;
  mask: string;
}

export interface Transaction {
  id: string;
  date: string;
  amount: number;
  merchant: string;
  category: string;
}

export interface TransactionsData {
  last_sync: string;
  account: Account;
  transactions: Transaction[];
}

export interface Period {
  start: string;
  end: string;
  days_elapsed: number;
  days_remaining: number;
}

export interface Spending {
  total: number;
  target: number;
  remaining: number;
  percent_used: number;
  daily_average: number;
  projected_total: number;
}

export interface CategoryTotal {
  category: string;
  amount: number;
}

export interface RecentTransaction {
  date: string;
  merchant: string;
  amount: number;
}

export type SpendingStatus = 'on_track' | 'watch' | 'over';
export type PaceStatus = 'ahead' | 'on_pace' | 'behind';

export interface Pace {
  expected: number;
  actual: number;
  diff: number;
  status: PaceStatus;
  percent_diff: number;
}

export interface Summary {
  computed_at: string;
  period: Period;
  spending: Spending;
  pace: Pace;
  status: SpendingStatus;
  top_categories: CategoryTotal[];
  recent_transactions: RecentTransaction[];
}

export interface SyncResult {
  synced: number;
  new: number;
  account: string;
  total_this_month: number;
  new_transaction_ids: string[];
}

export interface NewItem {
  merchant: string;
  amount: number;
  category: string;
}

export interface CheckResult {
  should_alert: boolean;
  reasons: string[];
  pace: string;
  oneline: string;
  new_transactions: number;
  new_items?: NewItem[];
}
