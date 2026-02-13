import { Command } from 'commander';
import yaml from 'js-yaml';
import {
  getConfigWithMigration,
  getOrCreateCurrentMonthData,
  saveMonthlyData,
  addTransactionsToMonthlyData,
  computeSummaryFromMonthlyData,
  saveSummary,
  saveSyncResult,
  ensureVaultExists,
  getPrimaryItem,
  getCurrentMonth,
  getMonthlyData,
} from '../vault.js';
import { createPlaidClient } from '../plaid.js';
import { getAccessToken } from '../lib/keychain.js';
import { installSchedule, removeSchedule, getScheduleStatus, getPlistPath } from '../lib/scheduler.js';
import type { Transaction, SyncResult } from '../types.js';

export const syncCommand = new Command('sync')
  .description('Sync transactions from Plaid')
  .option('--days <number>', 'Number of days to sync', '30')
  .option('--schedule <time>', 'Schedule daily sync (e.g., "daily" or "09:00")')
  .option('--status', 'Show schedule status')
  .option('--unschedule', 'Remove scheduled sync')
  .action(async (options) => {
    ensureVaultExists();

    // Handle schedule status
    if (options.status) {
      showScheduleStatus();
      return;
    }

    // Handle unschedule
    if (options.unschedule) {
      unscheduleSync();
      return;
    }

    // Handle schedule
    if (options.schedule) {
      scheduleSync(options.schedule);
      return;
    }

    // Regular sync
    await runSync(options.days);
  });

function showScheduleStatus(): void {
  const status = getScheduleStatus();

  console.log('\n  Sync Schedule Status\n');

  if (!status.installed) {
    console.log('  Status: Not scheduled');
    console.log('\n  To schedule daily sync:');
    console.log('    spend-pulse sync --schedule daily\n');
    return;
  }

  console.log(`  Status: ${status.loaded ? 'Active' : 'Installed (not loaded)'}`);
  if (status.nextRun) {
    console.log(`  Schedule: ${status.nextRun}`);
  }
  console.log(`  Plist: ${getPlistPath()}`);
  console.log('\n  To remove schedule:');
  console.log('    spend-pulse sync --unschedule\n');
}

function scheduleSync(timeArg: string): void {
  let hour = 9;
  let minute = 0;

  if (timeArg !== 'daily') {
    // Parse time like "09:00" or "14:30"
    const match = timeArg.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) {
      console.error('Invalid time format. Use "daily" or "HH:MM" (e.g., "09:00")');
      process.exit(1);
    }
    hour = parseInt(match[1], 10);
    minute = parseInt(match[2], 10);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      console.error('Invalid time. Hour must be 0-23, minute must be 0-59');
      process.exit(1);
    }
  }

  console.log(`\n  Scheduling daily sync at ${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}...`);

  try {
    installSchedule({ hour, minute });
    console.log('  Schedule installed successfully!\n');
    console.log(`  Plist: ${getPlistPath()}`);
    console.log('\n  The sync will run automatically every day.');
    console.log('  Check status: spend-pulse sync --status');
    console.log('  Remove: spend-pulse sync --unschedule\n');
  } catch (error) {
    console.error('  Failed to install schedule:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

function unscheduleSync(): void {
  const status = getScheduleStatus();

  if (!status.installed) {
    console.log('  No schedule to remove.');
    return;
  }

  console.log('  Removing scheduled sync...');

  try {
    removeSchedule();
    console.log('  Schedule removed successfully.\n');
  } catch (error) {
    console.error('  Failed to remove schedule:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

async function runSync(daysArg: string): Promise<void> {
  const config = await getConfigWithMigration();
  if (!config) {
    console.error('Not configured. Run "spend-pulse setup" first.');
    process.exit(1);
  }

  const primaryItem = getPrimaryItem(config);
  if (!primaryItem) {
    console.error('No account connected. Run "spend-pulse setup" first.');
    process.exit(1);
  }

  const accessToken = await getAccessToken(primaryItem.item_id);
  if (!accessToken) {
    console.error('Access token not found in Keychain. Run "spend-pulse setup" again.');
    process.exit(1);
  }

  const days = parseInt(daysArg, 10);
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const startStr = formatDate(startDate);
  const endStr = formatDate(endDate);

  console.log(`Syncing transactions from ${startStr} to ${endStr}...`);

  try {
    const client = await createPlaidClient(config);

    const response = await client.transactionsGet({
      access_token: accessToken,
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
      pending: t.pending,
      pending_transaction_id: t.pending_transaction_id ?? undefined,
    }));

    // Group transactions by month
    const transactionsByMonth = new Map<string, Transaction[]>();
    for (const t of newTransactions) {
      const month = t.date.slice(0, 7); // "YYYY-MM"
      if (!transactionsByMonth.has(month)) {
        transactionsByMonth.set(month, []);
      }
      transactionsByMonth.get(month)!.push(t);
    }

    // Process each month
    let totalAdded = 0;
    const newTransactionIds: string[] = [];

    for (const [month, transactions] of transactionsByMonth) {
      let monthlyData = getMonthlyData(month);

      if (!monthlyData) {
        monthlyData = {
          month,
          last_sync: new Date().toISOString(),
          transactions: [],
        };
      }

      const { added, updated } = addTransactionsToMonthlyData(monthlyData, transactions);
      saveMonthlyData(updated);

      totalAdded += added;

      // Track new transaction IDs (only from current month for alert purposes)
      if (month === getCurrentMonth()) {
        const existingIds = new Set(monthlyData.transactions.map(t => t.id));
        const newIds = transactions.filter(t => !existingIds.has(t.id)).map(t => t.id);
        newTransactionIds.push(...newIds);
      }
    }

    // Compute summary for current month
    const currentMonthData = getOrCreateCurrentMonthData();
    const summary = computeSummaryFromMonthlyData(currentMonthData, config.settings);
    saveSummary(summary);

    // Save sync result for check command
    const syncResult: SyncResult = {
      synced: plaidTransactions.length,
      new: totalAdded,
      account: `${account.name} (...${account.mask})`,
      total_this_month: summary.spending.total,
      new_transaction_ids: newTransactionIds,
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
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}
