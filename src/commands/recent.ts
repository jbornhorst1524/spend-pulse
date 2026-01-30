import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getTransactions,
  getMockTransactions,
  saveTransactions,
  ensureVaultExists,
} from '../vault.js';

export const recentCommand = new Command('recent')
  .description('Show recent transactions')
  .option('--days <number>', 'Number of days to show', '5')
  .option('--count <number>', 'Number of transactions to show')
  .action((options) => {
    ensureVaultExists();

    let transactions = getTransactions();
    if (!transactions) {
      transactions = getMockTransactions();
      saveTransactions(transactions);
    }

    const now = new Date();
    const days = parseInt(options.days, 10);
    const cutoffDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const cutoffStr = cutoffDate.toISOString().split('T')[0];

    let filtered = transactions.transactions
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
