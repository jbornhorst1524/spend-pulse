import { Command } from 'commander';
import yaml from 'js-yaml';
import path from 'path';
import {
  getConfigWithMigration,
  getDefaultConfig,
  saveConfig,
  getOrCreateCurrentMonthData,
  saveMonthlyData,
  getMockMonthlyData,
  computeSummaryFromMonthlyData,
  saveSummary,
  getSyncResult,
  ensureVaultExists,
  updateMonthlyLastCheck,
  getCurrentMonth,
  getPreviousMonth,
  getMonthlyData,
  buildCumulativeSpendCurve,
  paths,
} from '../vault.js';
import type { Summary, CheckResult, NewItem, MonthlyData } from '../types.js';

export const checkCommand = new Command('check')
  .description('Check if a spending alert should be sent')
  .option('--chart', 'Generate a spending chart PNG')
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

    const syncResult = getSyncResult();
    const newTransactionCount = syncResult?.new ?? 0;
    const newTransactionIds = new Set(syncResult?.new_transaction_ids ?? []);

    // Look up new transaction details
    const newItems: NewItem[] = monthlyData.transactions
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
      reasons.push('spending pace elevated');
    } else if (summary.status === 'over') {
      reasons.push('over budget');
    }

    // Alert if significantly over pace (more than 10%)
    if (summary.pace.status === 'behind' && summary.pace.percent_diff > 10) {
      reasons.push(`${Math.round(summary.pace.percent_diff)}% over pace`);
    }

    // Alert if remaining budget is low (< $500)
    if (summary.spending.remaining < 500 && summary.spending.remaining > 0) {
      reasons.push(`only $${Math.round(summary.spending.remaining)} remaining`);
    }

    // Alert at end of month (last 3 days)
    if (summary.period.days_remaining <= 3 && summary.period.days_remaining > 0) {
      reasons.push('end of month approaching');
    }

    // Alert at start of month (first day)
    if (summary.period.days_elapsed === 1) {
      reasons.push('new month started');
    }

    const shouldAlert = reasons.length > 0;

    // Derive pace values from summary (single source of truth)
    const daysInMonth = summary.period.days_elapsed + summary.period.days_remaining;
    const paceStatusMap: Record<string, 'under' | 'on_track' | 'over'> = {
      ahead: 'under',
      on_pace: 'on_track',
      behind: 'over',
    };
    const paceStatus = paceStatusMap[summary.pace.status] ?? 'on_track';

    // Format oneline
    const oneline = formatOneline(summary);

    const result: CheckResult = {
      should_alert: shouldAlert,
      reasons,
      month: monthlyData.month,
      budget: config.settings.monthly_target,
      spent: Math.round(summary.spending.total * 100) / 100,
      remaining: Math.round(summary.spending.remaining * 100) / 100,
      day_of_month: summary.period.days_elapsed,
      days_in_month: daysInMonth,
      days_remaining: summary.period.days_remaining,
      expected_spend: summary.pace.expected,
      pace: paceStatus,
      pace_delta: summary.pace.diff,
      pace_percent: Math.round(summary.pace.percent_diff),
      pace_source: summary.pace.source,
      oneline,
      new_transactions: newTransactionCount,
      ...(monthlyData.last_check && { last_check: monthlyData.last_check }),
      ...(newItems.length > 0 && { new_items: newItems }),
    };

    // Generate chart if requested
    if (options.chart) {
      const { renderSpendingChart } = await import('../lib/chart.js');
      const fs = await import('fs');

      const currentCurve = buildCumulativeSpendCurve(monthlyData);
      const chartPath = path.join(paths.vault, 'chart.png');

      const png = await renderSpendingChart({
        currentMonthCurve: currentCurve,
        lastMonthCurve,
        monthlyTarget: config.settings.monthly_target,
        currentDay: summary.period.days_elapsed,
        daysInMonth,
        spent: summary.spending.total,
        remaining: summary.spending.remaining,
        monthLabel: monthlyData.month,
      });

      fs.writeFileSync(chartPath, png);
      result.chart_path = chartPath;
    }

    // Update last_check timestamp
    updateMonthlyLastCheck(getCurrentMonth());

    console.log(yaml.dump(result, { lineWidth: -1 }));
  });

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

  const statusIcon = status === 'on_track' ? '>' : status === 'watch' ? '!' : 'X';
  const statusText = status === 'on_track' ? 'On track' : status === 'watch' ? 'Watch' : 'Over budget';
  const remainingText = spending.remaining >= 0 ? `${remaining} left` : `${remaining} over`;

  return `${monthName}: ${total} of ${target} (${percent}%) | ${remainingText} | ${days} days | ${statusIcon} ${statusText}`;
}

function formatMoney(amount: number): string {
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`.replace('.0k', 'k');
  }
  return `$${Math.round(amount).toLocaleString()}`;
}
