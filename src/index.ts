#!/usr/bin/env node

import { Command } from 'commander';
import { configCommand } from './commands/config.js';
import { statusCommand } from './commands/status.js';
import { recentCommand } from './commands/recent.js';
import { setupCommand } from './commands/setup.js';
import { syncCommand } from './commands/sync.js';
import { checkCommand } from './commands/check.js';
import { linkCommand } from './commands/link.js';

const program = new Command();

program
  .name('spend-pulse')
  .description('Proactive spending alerts via Plaid')
  .version('0.1.0');

program.addCommand(setupCommand);
program.addCommand(syncCommand);
program.addCommand(checkCommand);
program.addCommand(configCommand);
program.addCommand(statusCommand);
program.addCommand(recentCommand);
program.addCommand(linkCommand);

program.parse();
