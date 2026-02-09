import fs from 'fs';
import { Command } from 'commander';
import {
  getConfigWithMigration,
  getDefaultConfig,
  saveConfig,
  getOrCreateCurrentMonthData,
  saveMonthlyData,
  getMockMonthlyData,
  computeSummaryFromMonthlyData,
  ensureVaultExists,
  getPreviousMonth,
  getMonthlyData,
  buildCumulativeSpendCurve,
  paths,
} from '../vault.js';
import { renderSpendingChart } from '../lib/chart.js';

export const chartCommand = new Command('chart')
  .description('Generate a spending chart PNG')
  .option('-o, --output <path>', 'Output file path')
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

    // Load last month's data
    const prevMonth = getPreviousMonth(monthlyData.month);
    const lastMonthData = getMonthlyData(prevMonth);
    const lastMonthCurve = lastMonthData ? buildCumulativeSpendCurve(lastMonthData) : null;

    // Compute summary for spending totals
    const summary = computeSummaryFromMonthlyData(monthlyData, config.settings, lastMonthCurve);
    const currentCurve = buildCumulativeSpendCurve(monthlyData);
    const daysInMonth = summary.period.days_elapsed + summary.period.days_remaining;

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

    const outputPath = options.output ?? `${paths.vault}/chart.png`;
    fs.writeFileSync(outputPath, png);

    // Output the path for OpenClaw to capture
    console.log(outputPath);
  });
