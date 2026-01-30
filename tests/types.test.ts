import { describe, it, expect } from 'vitest';
import type {
  PlaidMode,
  PlaidItem,
  Config,
  LegacyConfig,
  Transaction,
  MonthlyData,
  CheckResult,
  Summary,
} from '../src/types.js';

describe('types', () => {
  describe('PlaidMode', () => {
    it('should accept valid modes', () => {
      const sandbox: PlaidMode = 'sandbox';
      const development: PlaidMode = 'development';

      expect(sandbox).toBe('sandbox');
      expect(development).toBe('development');
    });
  });

  describe('PlaidItem', () => {
    it('should have required fields', () => {
      const item: PlaidItem = {
        item_id: 'item-123',
        institution: 'Test Bank',
        accounts: ['Checking (...1234)', 'Savings (...5678)'],
      };

      expect(item.item_id).toBe('item-123');
      expect(item.institution).toBe('Test Bank');
      expect(item.accounts).toHaveLength(2);
    });
  });

  describe('Config', () => {
    it('should have new format structure', () => {
      const config: Config = {
        plaid: {
          mode: 'sandbox',
          items: [
            {
              item_id: 'item-abc',
              institution: 'First Bank',
              accounts: ['Card (...9999)'],
            },
          ],
        },
        settings: {
          monthly_target: 8000,
          sync_days: 30,
          timezone: 'America/Chicago',
        },
      };

      expect(config.plaid.mode).toBe('sandbox');
      expect(config.plaid.items).toHaveLength(1);
      expect(config.settings.monthly_target).toBe(8000);
    });
  });

  describe('LegacyConfig', () => {
    it('should have old format with credentials', () => {
      const legacyConfig: LegacyConfig = {
        plaid: {
          client_id: 'client-abc',
          secret: 'secret-xyz',
          access_token: 'access-123',
        },
        settings: {
          monthly_target: 5000,
          sync_days: 14,
          timezone: 'America/New_York',
        },
      };

      expect(legacyConfig.plaid.client_id).toBe('client-abc');
      expect(legacyConfig.plaid.secret).toBe('secret-xyz');
      expect(legacyConfig.plaid.access_token).toBe('access-123');
    });
  });

  describe('Transaction', () => {
    it('should have all required fields', () => {
      const tx: Transaction = {
        id: 'tx-001',
        date: '2026-01-15',
        amount: 125.50,
        merchant: 'Coffee Shop',
        category: 'Food',
      };

      expect(tx.id).toBe('tx-001');
      expect(tx.date).toBe('2026-01-15');
      expect(tx.amount).toBe(125.50);
      expect(tx.merchant).toBe('Coffee Shop');
      expect(tx.category).toBe('Food');
    });
  });

  describe('MonthlyData', () => {
    it('should have required fields', () => {
      const data: MonthlyData = {
        month: '2026-01',
        last_sync: '2026-01-15T10:00:00Z',
        transactions: [],
      };

      expect(data.month).toBe('2026-01');
      expect(data.last_sync).toBe('2026-01-15T10:00:00Z');
      expect(data.transactions).toEqual([]);
    });

    it('should allow optional last_check', () => {
      const data: MonthlyData = {
        month: '2026-01',
        last_sync: '2026-01-15T10:00:00Z',
        last_check: '2026-01-15T12:00:00Z',
        transactions: [],
      };

      expect(data.last_check).toBe('2026-01-15T12:00:00Z');
    });
  });

  describe('CheckResult', () => {
    it('should have all required fields', () => {
      const result: CheckResult = {
        should_alert: true,
        reasons: ['3 new transactions', 'end of month approaching'],
        month: '2026-01',
        budget: 8000,
        spent: 6500,
        remaining: 1500,
        day_of_month: 28,
        days_in_month: 31,
        days_remaining: 3,
        expected_spend: 7225.81,
        pace: 'under',
        pace_delta: -725.81,
        pace_percent: -10,
        oneline: 'Jan: $6.5k of $8k (81%) | $1.5k left | 3 days | > On track',
        new_transactions: 3,
      };

      expect(result.should_alert).toBe(true);
      expect(result.reasons).toHaveLength(2);
      expect(result.pace).toBe('under');
    });

    it('should allow optional fields', () => {
      const result: CheckResult = {
        should_alert: false,
        reasons: [],
        month: '2026-01',
        budget: 8000,
        spent: 2000,
        remaining: 6000,
        day_of_month: 10,
        days_in_month: 31,
        days_remaining: 21,
        expected_spend: 2580.65,
        pace: 'under',
        pace_delta: -580.65,
        pace_percent: -22,
        oneline: 'Jan: $2k of $8k (25%) | $6k left | 21 days | > On track',
        new_transactions: 0,
        last_check: '2026-01-09T18:00:00Z',
        new_items: [
          { merchant: 'Store', amount: 50, category: 'Shopping' },
        ],
      };

      expect(result.last_check).toBe('2026-01-09T18:00:00Z');
      expect(result.new_items).toHaveLength(1);
    });
  });
});
