import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getOrCreateCurrentMonthData,
  saveMonthlyData,
  getMockMonthlyData,
  ensureVaultExists,
  getMonthlyData,
} from '../vault.js';

export const recentCommand = new Command('recent')
  .description('Show recent transactions')
  .option('--days <number>', 'Number of days to show', '5')
  .option('--count <number>', 'Number of transactions to show')
  .action((options) => {
    ensureVaultExists();

    // Get current month's data
    let monthlyData = getOrCreateCurrentMonthData();

    // If no transactions, use mock data for demo
    if (monthlyData.transactions.length === 0) {
      monthlyData = getMockMonthlyData();
      saveMonthlyData(monthlyData);
    }

    const now = new Date();
    const days = parseInt(options.days, 10);
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    // If looking back more than current month, also check previous month
    let allTransactions = [...monthlyData.transactions];

    // Check if we need to look at previous month
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const cutoffYear = cutoffDate.getFullYear();
    const cutoffMonth = cutoffDate.getMonth();

    if (cutoffYear < currentYear || cutoffMonth < currentMonth) {
      // Look at previous month
      const prevMonth = cutoffMonth === 0
        ? `${cutoffYear - 1}-12`
        : `${cutoffYear}-${String(cutoffMonth).padStart(2, '0')}`;

      const prevMonthData = getMonthlyData(prevMonth);
      if (prevMonthData) {
        allTransactions = [...allTransactions, ...prevMonthData.transactions];
      }
    }

    let filtered = allTransactions
      .filter(t => t.date >= cutoffStr)
      .sort((a, b) => b.date.localeCompare(a.date));

    if (options.count) {
      const count = parseInt(options.count, 10);
      filtered = filtered.slice(0, count);
    }

    const output = filtered.map(t => ({
      date: t.date,
      amount: t.amount,
      merchant: t.merchant,
      category: t.category,
    }));

    console.log(yaml.dump({ transactions: output }, { lineWidth: -1 }));
  });
