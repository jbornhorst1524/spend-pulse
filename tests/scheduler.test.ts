import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Import the scheduler module
import { generatePlist, getPlistPath } from '../src/lib/scheduler.js';

describe('scheduler', () => {
  describe('generatePlist', () => {
    it('should generate valid plist XML with default time', () => {
      const plist = generatePlist();

      expect(plist).toContain('<?xml version="1.0"');
      expect(plist).toContain('<!DOCTYPE plist');
      expect(plist).toContain('<key>Label</key>');
      expect(plist).toContain('<string>com.spend-pulse.sync</string>');
      expect(plist).toContain('<key>Hour</key>');
      expect(plist).toContain('<integer>9</integer>');
      expect(plist).toContain('<key>Minute</key>');
      expect(plist).toContain('<integer>0</integer>');
    });

    it('should use custom time when provided', () => {
      const plist = generatePlist({ hour: 14, minute: 30 });

      expect(plist).toContain('<integer>14</integer>');
      expect(plist).toContain('<integer>30</integer>');
    });

    it('should include sync command in ProgramArguments', () => {
      const plist = generatePlist();

      expect(plist).toContain('<key>ProgramArguments</key>');
      expect(plist).toContain('<string>sync</string>');
    });

    it('should configure log paths in ~/.spend-pulse/', () => {
      const plist = generatePlist();
      const homedir = os.homedir();

      expect(plist).toContain(`${homedir}/.spend-pulse/sync.log`);
      expect(plist).toContain(`${homedir}/.spend-pulse/sync.error.log`);
    });

    it('should set RunAtLoad to false', () => {
      const plist = generatePlist();

      expect(plist).toContain('<key>RunAtLoad</key>');
      expect(plist).toContain('<false/>');
    });
  });

  describe('getPlistPath', () => {
    it('should return path in ~/Library/LaunchAgents/', () => {
      const plistPath = getPlistPath();
      const homedir = os.homedir();

      expect(plistPath).toBe(path.join(homedir, 'Library', 'LaunchAgents', 'com.spend-pulse.sync.plist'));
    });
  });
});
