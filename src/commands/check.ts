import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getConfig,
  getDefaultConfig,
  saveConfig,
  getTransactions,
  getMockTransactions,
  saveTransactions,
  computeSummary,
  saveSummary,
  getSyncResult,
  ensureVaultExists,
} from '../vault.js';
import type { Summary, CheckResult, NewItem } from '../types.js';

export const checkCommand = new Command('check')
  .description('Check if a spending alert should be sent')
  .action(() => {
    ensureVaultExists();

    let config = getConfig();
    if (!config) {
      config = getDefaultConfig();
      saveConfig(config);
    }

    let transactions = getTransactions();
    if (!transactions) {
      transactions = getMockTransactions();
      saveTransactions(transactions);
    }

    const summary = computeSummary(transactions, config.settings);
    saveSummary(summary);

    const syncResult = getSyncResult();
    const newTransactionCount = syncResult?.new ?? 0;
    const newTransactionIds = new Set(syncResult?.new_transaction_ids ?? []);

    // Look up new transaction details
    const newItems: NewItem[] = transactions.transactions
      .filter(t => newTransactionIds.has(t.id))
      .map(t => ({
        merchant: t.merchant,
        amount: t.amount,
        category: t.category,
      }));

    const reasons: string[] = [];

    // Alert if there are new transactions
    if (newTransactionCount > 0) {
      reasons.push(`${newTransactionCount} new transaction${newTransactionCount > 1 ? 's' : ''}`);
    }

    // Alert if status changed to watch or over
    if (summary.status === 'watch') {
      reasons.push('status is "watch" - spending pace elevated');
    } else if (summary.status === 'over') {
      reasons.push('over budget');
    }

    // Alert if significantly behind pace
    if (summary.pace.status === 'behind' && summary.pace.percent_diff > 15) {
      reasons.push(`${Math.round(summary.pace.percent_diff)}% behind pace`);
    }

    const shouldAlert = reasons.length > 0;

    // Format pace string
    const paceStr = formatPace(summary);

    // Format oneline
    const oneline = formatOneline(summary);

    const result: CheckResult = {
      should_alert: shouldAlert,
      reasons,
      pace: paceStr,
      oneline,
      new_transactions: newTransactionCount,
      ...(newItems.length > 0 && { new_items: newItems }),
    };

    console.log(yaml.dump(result, { lineWidth: -1 }));
  });

function formatPace(summary: Summary): string {
  const { pace } = summary;
  const diffAbs = Math.abs(pace.diff);
  const percentAbs = Math.abs(pace.percent_diff);

  if (pace.status === 'ahead') {
    return `ahead by $${diffAbs.toLocaleString()} (spending ${percentAbs}% less than expected)`;
  } else if (pace.status === 'behind') {
    return `behind by $${diffAbs.toLocaleString()} (spending ${percentAbs}% more than expected)`;
  } else {
    return `on pace (within 5% of expected)`;
  }
}

function formatOneline(summary: Summary): string {
  const { spending, period, status } = summary;

  const total = formatMoney(spending.total);
  const target = formatMoney(spending.target);
  const remaining = formatMoney(Math.abs(spending.remaining));
  const percent = Math.round(spending.percent_used);
  const days = period.days_remaining;

  const [, month] = period.start.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[month - 1];

  const statusIcon = status === 'on_track' ? '✓' : status === 'watch' ? '⚠' : '✗';
  const statusText = status === 'on_track' ? 'On track' : status === 'watch' ? 'Watch' : 'Over budget';
  const remainingText = spending.remaining >= 0 ? `${remaining} left` : `${remaining} over`;

  return `${monthName}: ${total} of ${target} (${percent}%) • ${remainingText} • ${days} days • ${statusIcon} ${statusText}`;
}

function formatMoney(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`.replace('.0k', 'k');
  }
  return `$${Math.round(amount).toLocaleString()}`;
}
