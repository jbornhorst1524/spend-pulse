import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getConfig,
  getTransactions,
  saveTransactions,
  computeSummary,
  saveSummary,
  saveSyncResult,
  ensureVaultExists,
} from '../vault.js';
import { createPlaidClient } from '../plaid.js';
import type { Transaction, TransactionsData, SyncResult } from '../types.js';

export const syncCommand = new Command('sync')
  .description('Sync transactions from Plaid')
  .option('--days <number>', 'Number of days to sync', '30')
  .action(async (options) => {
    ensureVaultExists();

    const config = getConfig();
    if (!config) {
      console.error('Not configured. Run "spend-pulse setup" first.');
      process.exit(1);
    }

    if (!config.plaid.access_token) {
      console.error('No account connected. Run "spend-pulse setup" first.');
      process.exit(1);
    }

    const days = parseInt(options.days, 10);
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    const startStr = formatDate(startDate);
    const endStr = formatDate(endDate);

    console.log(`Syncing transactions from ${startStr} to ${endStr}...`);

    try {
      const client = createPlaidClient(config);

      const response = await client.transactionsGet({
        access_token: config.plaid.access_token,
        start_date: startStr,
        end_date: endStr,
      });

      const { accounts, transactions: plaidTransactions } = response.data;

      // Get primary account (first one)
      const account = accounts[0];
      if (!account) {
        console.error('No accounts found.');
        process.exit(1);
      }

      // Convert Plaid transactions to our format
      const newTransactions: Transaction[] = plaidTransactions.map(t => ({
        id: t.transaction_id,
        date: t.date,
        amount: t.amount, // Plaid uses positive for debits
        merchant: t.merchant_name || t.name,
        category: t.personal_finance_category?.primary || t.category?.[0] || 'Uncategorized',
      }));

      // Load existing transactions and merge
      let existing = getTransactions();
      const existingIds = new Set(existing?.transactions.map(t => t.id) || []);

      const addedTransactions = newTransactions.filter(t => !existingIds.has(t.id));

      const allTransactions = [
        ...(existing?.transactions || []),
        ...addedTransactions,
      ].sort((a, b) => b.date.localeCompare(a.date));

      // Filter to keep only recent transactions (based on sync_days setting)
      const cutoffDate = new Date(endDate.getTime() - config.settings.sync_days * 24 * 60 * 60 * 1000);
      const cutoffStr = formatDate(cutoffDate);
      const filteredTransactions = allTransactions.filter(t => t.date >= cutoffStr);

      const transactionsData: TransactionsData = {
        last_sync: new Date().toISOString(),
        account: {
          name: account.name,
          mask: account.mask || '',
        },
        transactions: filteredTransactions,
      };

      saveTransactions(transactionsData);

      // Recompute summary
      const summary = computeSummary(transactionsData, config.settings);
      saveSummary(summary);

      // Save sync result for check command
      const syncResult: SyncResult = {
        synced: plaidTransactions.length,
        new: addedTransactions.length,
        account: `${account.name} (...${account.mask})`,
        total_this_month: summary.spending.total,
        new_transaction_ids: addedTransactions.map(t => t.id),
      };
      saveSyncResult(syncResult);

      console.log(yaml.dump(syncResult, { lineWidth: -1 }));
    } catch (error: any) {
      if (error?.response?.data) {
        const plaidError = error.response.data;
        console.error(`Plaid error: ${plaidError.error_message || plaidError.error_code}`);

        if (plaidError.error_code === 'ITEM_LOGIN_REQUIRED') {
          console.error('Your bank connection needs to be refreshed. Run "spend-pulse setup" again.');
        }
      } else {
        console.error('Sync failed:', error instanceof Error ? error.message : error);
      }
      process.exit(1);
    }
  });

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
