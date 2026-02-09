import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getConfigWithMigration,
  getDefaultConfig,
  saveConfig,
  getOrCreateCurrentMonthData,
  saveMonthlyData,
  getMockMonthlyData,
  computeSummaryFromMonthlyData,
  saveSummary,
  ensureVaultExists,
  getPreviousMonth,
  getMonthlyData,
  buildCumulativeSpendCurve,
} from '../vault.js';
import type { Summary } from '../types.js';

export const statusCommand = new Command('status')
  .description('Show spending summary')
  .option('--oneline', 'Output a single-line human-readable summary')
  .action(async (options) => {
    ensureVaultExists();

    let config = await getConfigWithMigration();
    if (!config) {
      config = getDefaultConfig();
      saveConfig(config);
    }

    // Get current month's data
    let monthlyData = getOrCreateCurrentMonthData();

    // If no transactions, use mock data for demo
    if (monthlyData.transactions.length === 0) {
      monthlyData = getMockMonthlyData();
      saveMonthlyData(monthlyData);
    }

    // Load last month's data and build cumulative spend curve
    const prevMonth = getPreviousMonth(monthlyData.month);
    const lastMonthData = getMonthlyData(prevMonth);
    const lastMonthCurve = lastMonthData ? buildCumulativeSpendCurve(lastMonthData) : null;

    const summary = computeSummaryFromMonthlyData(monthlyData, config.settings, lastMonthCurve);
    saveSummary(summary);

    if (options.oneline) {
      console.log(formatOneline(summary));
    } else {
      console.log(yaml.dump(summary, { lineWidth: -1 }));
    }
  });

function formatOneline(summary: Summary): string {
  const { spending, period, status } = summary;

  const total = formatMoney(spending.total);
  const target = formatMoney(spending.target);
  const remaining = formatMoney(spending.remaining);
  const percent = Math.round(spending.percent_used);
  const days = period.days_remaining;

  // Parse date string directly to avoid timezone issues
  const [, month] = period.start.split('-').map(Number);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[month - 1];

  const statusIcon = status === 'on_track' ? '>' : status === 'watch' ? '!' : 'X';
  const statusText = status === 'on_track' ? 'On track' : status === 'watch' ? 'Watch' : 'Over budget';

  return `${monthName}: ${total} of ${target} (${percent}%) | ${remaining} left | ${days} days | ${statusIcon} ${statusText}`;
}

function formatMoney(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`.replace('.0k', 'k');
  }
  return `$${amount.toLocaleString()}`;
}
