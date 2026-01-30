import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Use a temp directory for test data to avoid polluting real config
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-pulse-cli-test-'));
const TEST_VAULT = path.join(TEST_HOME, '.spend-pulse');

function runCLI(args: string[], env: Record<string, string> = {}): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node dist/index.js ${args.join(' ')}`, {
      encoding: 'utf-8',
      env: {
        ...process.env,
        HOME: TEST_HOME,
        ...env,
      },
      cwd: process.cwd(),
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error: any) {
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      exitCode: error.status || 1,
    };
  }
}

describe('CLI', () => {
  beforeAll(() => {
    // Ensure the project is built
    execSync('npm run build', { stdio: 'ignore' });
  });

  afterAll(() => {
    // Clean up test directory
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clean vault between tests
    if (fs.existsSync(TEST_VAULT)) {
      fs.rmSync(TEST_VAULT, { recursive: true, force: true });
    }
  });

  describe('--help', () => {
    it('should show help text', () => {
      const { stdout, exitCode } = runCLI(['--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('spend-pulse');
      expect(stdout).toContain('Proactive spending alerts via Plaid');
    });

    it('should list all commands', () => {
      const { stdout } = runCLI(['--help']);

      expect(stdout).toContain('setup');
      expect(stdout).toContain('sync');
      expect(stdout).toContain('check');
      expect(stdout).toContain('status');
      expect(stdout).toContain('recent');
      expect(stdout).toContain('link');
      expect(stdout).toContain('config');
    });
  });

  describe('--version', () => {
    it('should show version', () => {
      const { stdout, exitCode } = runCLI(['--version']);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('check', () => {
    it('should output YAML with required fields', () => {
      const { stdout, exitCode } = runCLI(['check']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('should_alert:');
      expect(stdout).toContain('reasons:');
      expect(stdout).toContain('month:');
      expect(stdout).toContain('budget:');
      expect(stdout).toContain('spent:');
      expect(stdout).toContain('remaining:');
      expect(stdout).toContain('pace:');
      expect(stdout).toContain('oneline:');
    });

    it('should create config and data files on first run', () => {
      runCLI(['check']);

      expect(fs.existsSync(path.join(TEST_VAULT, 'config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(TEST_VAULT, 'data'))).toBe(true);
    });
  });

  describe('status', () => {
    it('should output YAML summary', () => {
      const { stdout, exitCode } = runCLI(['status']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('computed_at:');
      expect(stdout).toContain('period:');
      expect(stdout).toContain('spending:');
      expect(stdout).toContain('pace:');
      expect(stdout).toContain('status:');
    });

    it('should support --oneline flag', () => {
      const { stdout, exitCode } = runCLI(['status', '--oneline']);

      expect(exitCode).toBe(0);
      // Should be a single line with key info
      expect(stdout.trim().split('\n')).toHaveLength(1);
      expect(stdout).toContain('$');
      expect(stdout).toContain('of');
      expect(stdout).toContain('%');
      expect(stdout).toContain('days');
    });
  });

  describe('recent', () => {
    it('should output transactions', () => {
      // First run check to create mock data
      runCLI(['check']);

      const { stdout, exitCode } = runCLI(['recent']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('transactions:');
    });

    it('should support --days flag', () => {
      runCLI(['check']);
      const { stdout, exitCode } = runCLI(['recent', '--days', '3']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('transactions:');
    });

    it('should support --count flag', () => {
      runCLI(['check']);
      const { stdout, exitCode } = runCLI(['recent', '--count', '2']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('transactions:');
    });
  });

  describe('config', () => {
    it('should show config when no args', () => {
      // First create config
      runCLI(['check']);

      const { stdout, exitCode } = runCLI(['config']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('plaid:');
      expect(stdout).toContain('settings:');
    });

    it('should get specific setting', () => {
      runCLI(['check']);
      const { stdout, exitCode } = runCLI(['config', 'target']);

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBe('8000');
    });

    it('should set specific setting', () => {
      runCLI(['check']);

      const { exitCode } = runCLI(['config', 'target', '5000']);
      expect(exitCode).toBe(0);

      const { stdout } = runCLI(['config', 'target']);
      expect(stdout.trim()).toBe('5000');
    });
  });

  describe('link --status', () => {
    it('should show no accounts when not configured', () => {
      runCLI(['check']); // Create initial config

      const { stdout, exitCode } = runCLI(['link', '--status']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Linked Accounts');
    });
  });

  describe('sync --status', () => {
    it('should show schedule status', () => {
      const { stdout, exitCode } = runCLI(['sync', '--status']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('Sync Schedule Status');
      expect(stdout).toContain('Status:');
    });
  });

  describe('setup --help', () => {
    it('should show setup options', () => {
      const { stdout, exitCode } = runCLI(['setup', '--help']);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('--client-id');
      expect(stdout).toContain('--secret');
      expect(stdout).toContain('--mode');
      expect(stdout).toContain('--upgrade');
    });
  });
});
