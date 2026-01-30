import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const PLIST_NAME = 'com.spend-pulse.sync.plist';
const LAUNCH_AGENTS_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');

export interface ScheduleConfig {
  hour: number;
  minute: number;
}

/**
 * Generate the launchd plist content for the sync job
 */
export function generatePlist(config: ScheduleConfig = { hour: 9, minute: 0 }): string {
  // Get the path to the spend-pulse binary
  const spendPulsePath = getSpendPulsePath();

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.spend-pulse.sync</string>

    <key>ProgramArguments</key>
    <array>
        <string>${spendPulsePath}</string>
        <string>sync</string>
    </array>

    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>${config.hour}</integer>
        <key>Minute</key>
        <integer>${config.minute}</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>${path.join(os.homedir(), '.spend-pulse', 'sync.log')}</string>

    <key>StandardErrorPath</key>
    <string>${path.join(os.homedir(), '.spend-pulse', 'sync.error.log')}</string>

    <key>RunAtLoad</key>
    <false/>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`;
}

/**
 * Get the path to the spend-pulse executable
 */
function getSpendPulsePath(): string {
  // Try to find spend-pulse in common locations
  const possiblePaths = [
    '/usr/local/bin/spend-pulse',
    '/opt/homebrew/bin/spend-pulse',
    path.join(os.homedir(), '.npm-global', 'bin', 'spend-pulse'),
    path.join(os.homedir(), 'node_modules', '.bin', 'spend-pulse'),
  ];

  // Check which command to get the actual path
  try {
    const whichResult = execSync('which spend-pulse', { encoding: 'utf-8' }).trim();
    if (whichResult && fs.existsSync(whichResult)) {
      return whichResult;
    }
  } catch {
    // which command failed, try fallbacks
  }

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  // Default to just the command name (will rely on PATH)
  return 'spend-pulse';
}

/**
 * Get the path to the plist file
 */
export function getPlistPath(): string {
  return path.join(LAUNCH_AGENTS_DIR, PLIST_NAME);
}

/**
 * Check if the schedule is installed
 */
export function isScheduleInstalled(): boolean {
  return fs.existsSync(getPlistPath());
}

/**
 * Install the launchd schedule
 */
export function installSchedule(config: ScheduleConfig = { hour: 9, minute: 0 }): void {
  // Ensure LaunchAgents directory exists
  if (!fs.existsSync(LAUNCH_AGENTS_DIR)) {
    fs.mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  // Unload existing job if present
  if (isScheduleInstalled()) {
    unloadSchedule();
  }

  // Write the plist file
  const plistContent = generatePlist(config);
  const plistPath = getPlistPath();
  fs.writeFileSync(plistPath, plistContent, 'utf-8');

  // Load the job
  loadSchedule();
}

/**
 * Remove the launchd schedule
 */
export function removeSchedule(): void {
  const plistPath = getPlistPath();

  if (!fs.existsSync(plistPath)) {
    return;
  }

  // Unload the job
  unloadSchedule();

  // Remove the plist file
  fs.unlinkSync(plistPath);
}

/**
 * Load the launchd job
 */
function loadSchedule(): void {
  try {
    execSync(`launchctl load ${getPlistPath()}`, { stdio: 'ignore' });
  } catch {
    // Job might already be loaded, ignore error
  }
}

/**
 * Unload the launchd job
 */
function unloadSchedule(): void {
  try {
    execSync(`launchctl unload ${getPlistPath()}`, { stdio: 'ignore' });
  } catch {
    // Job might not be loaded, ignore error
  }
}

/**
 * Get the current schedule status
 */
export function getScheduleStatus(): { installed: boolean; loaded: boolean; nextRun?: string } {
  const installed = isScheduleInstalled();

  if (!installed) {
    return { installed: false, loaded: false };
  }

  // Check if job is loaded
  let loaded = false;
  try {
    const result = execSync('launchctl list | grep com.spend-pulse.sync', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    loaded = result.includes('com.spend-pulse.sync');
  } catch {
    loaded = false;
  }

  // Parse the plist to get the schedule time
  let nextRun: string | undefined;
  try {
    const plistContent = fs.readFileSync(getPlistPath(), 'utf-8');
    const hourMatch = plistContent.match(/<key>Hour<\/key>\s*<integer>(\d+)<\/integer>/);
    const minuteMatch = plistContent.match(/<key>Minute<\/key>\s*<integer>(\d+)<\/integer>/);

    if (hourMatch && minuteMatch) {
      const hour = parseInt(hourMatch[1], 10);
      const minute = parseInt(minuteMatch[1], 10);
      nextRun = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')} daily`;
    }
  } catch {
    // Could not parse plist
  }

  return { installed, loaded, nextRun };
}
