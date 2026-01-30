import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { Transaction, Settings, MonthlyData, Config, LegacyConfig } from '../src/types.js';

// Mock keychain module before importing vault
vi.mock('../src/lib/keychain.js', () => ({
  setPlaidCredentials: vi.fn(),
  setAccessToken: vi.fn(),
  getPlaidCredentials: vi.fn(),
  getAccessToken: vi.fn(),
}));

// Import after mocking
const vaultModule = await import('../src/vault.js');
const {
  readYaml,
  writeYaml,
  isLegacyConfig,
  computeSummaryFromMonthlyData,
  addTransactionsToMonthlyData,
  getCurrentMonth,
} = vaultModule;

describe('vault', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-pulse-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readYaml / writeYaml', () => {
    it('should write and read YAML files', () => {
      const filePath = path.join(tempDir, 'test.yaml');
      const data = { foo: 'bar', count: 42 };

      writeYaml(filePath, data);
      const result = readYaml<typeof data>(filePath);

      expect(result).toEqual(data);
    });

    it('should return null for non-existent files', () => {
      const result = readYaml(path.join(tempDir, 'nonexistent.yaml'));
      expect(result).toBeNull();
    });
  });

  describe('isLegacyConfig', () => {
    it('should detect legacy config with client_id', () => {
      const legacyConfig: LegacyConfig = {
        plaid: {
          client_id: 'abc123',
          secret: 'secret123',
          access_token: 'token123',
        },
        settings: {
          monthly_target: 8000,
          sync_days: 30,
          timezone: 'America/Chicago',
        },
      };

      expect(isLegacyConfig(legacyConfig)).toBe(true);
    });

    it('should return false for new config format', () => {
      const newConfig: Config = {
        plaid: {
          mode: 'sandbox',
          items: [],
        },
        settings: {
          monthly_target: 8000,
          sync_days: 30,
          timezone: 'America/Chicago',
        },
      };

      expect(isLegacyConfig(newConfig)).toBe(false);
    });
  });

  describe('getCurrentMonth', () => {
    it('should return current month in YYYY-MM format', () => {
      const month = getCurrentMonth();
      expect(month).toMatch(/^\d{4}-\d{2}$/);

      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      expect(month).toBe(expected);
    });
  });

  describe('addTransactionsToMonthlyData', () => {
    it('should add new transactions and dedupe existing', () => {
      const existingData: MonthlyData = {
        month: '2026-01',
        last_sync: '2026-01-15T10:00:00Z',
        transactions: [
          { id: 'tx1', date: '2026-01-10', amount: 50, merchant: 'Store A', category: 'Shopping' },
        ],
      };

      const newTransactions: Transaction[] = [
        { id: 'tx1', date: '2026-01-10', amount: 50, merchant: 'Store A', category: 'Shopping' }, // duplicate
        { id: 'tx2', date: '2026-01-12', amount: 100, merchant: 'Store B', category: 'Food' }, // new
      ];

      const { added, updated } = addTransactionsToMonthlyData(existingData, newTransactions);

      expect(added).toBe(1);
      expect(updated.transactions).toHaveLength(2);
      expect(updated.transactions.map(t => t.id)).toContain('tx1');
      expect(updated.transactions.map(t => t.id)).toContain('tx2');
    });

    it('should sort transactions by date descending', () => {
      const existingData: MonthlyData = {
        month: '2026-01',
        last_sync: '2026-01-01T00:00:00Z',
        transactions: [],
      };

      const newTransactions: Transaction[] = [
        { id: 'tx1', date: '2026-01-05', amount: 50, merchant: 'A', category: 'X' },
        { id: 'tx2', date: '2026-01-15', amount: 100, merchant: 'B', category: 'Y' },
        { id: 'tx3', date: '2026-01-10', amount: 75, merchant: 'C', category: 'Z' },
      ];

      const { updated } = addTransactionsToMonthlyData(existingData, newTransactions);

      expect(updated.transactions[0].id).toBe('tx2'); // Jan 15
      expect(updated.transactions[1].id).toBe('tx3'); // Jan 10
      expect(updated.transactions[2].id).toBe('tx1'); // Jan 5
    });
  });

  describe('computeSummaryFromMonthlyData', () => {
    const settings: Settings = {
      monthly_target: 1000,
      sync_days: 30,
      timezone: 'America/Chicago',
    };

    it('should compute spending totals correctly', () => {
      const monthlyData: MonthlyData = {
        month: getCurrentMonth(),
        last_sync: new Date().toISOString(),
        transactions: [
          { id: 'tx1', date: new Date().toISOString().split('T')[0], amount: 100, merchant: 'A', category: 'Food' },
          { id: 'tx2', date: new Date().toISOString().split('T')[0], amount: 250, merchant: 'B', category: 'Shopping' },
        ],
      };

      const summary = computeSummaryFromMonthlyData(monthlyData, settings);

      expect(summary.spending.total).toBe(350);
      expect(summary.spending.target).toBe(1000);
      expect(summary.spending.remaining).toBe(650);
    });

    it('should compute category totals', () => {
      const monthlyData: MonthlyData = {
        month: getCurrentMonth(),
        last_sync: new Date().toISOString(),
        transactions: [
          { id: 'tx1', date: new Date().toISOString().split('T')[0], amount: 100, merchant: 'A', category: 'Food' },
          { id: 'tx2', date: new Date().toISOString().split('T')[0], amount: 50, merchant: 'B', category: 'Food' },
          { id: 'tx3', date: new Date().toISOString().split('T')[0], amount: 200, merchant: 'C', category: 'Shopping' },
        ],
      };

      const summary = computeSummaryFromMonthlyData(monthlyData, settings);

      expect(summary.top_categories).toHaveLength(2);
      expect(summary.top_categories[0].category).toBe('Shopping');
      expect(summary.top_categories[0].amount).toBe(200);
      expect(summary.top_categories[1].category).toBe('Food');
      expect(summary.top_categories[1].amount).toBe(150);
    });

    it('should determine status correctly', () => {
      const now = new Date();
      const monthlyData: MonthlyData = {
        month: getCurrentMonth(),
        last_sync: now.toISOString(),
        transactions: [
          { id: 'tx1', date: now.toISOString().split('T')[0], amount: 1500, merchant: 'A', category: 'X' },
        ],
      };

      const summary = computeSummaryFromMonthlyData(monthlyData, settings);

      expect(summary.status).toBe('over');
    });
  });
});
