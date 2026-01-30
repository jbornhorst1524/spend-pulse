import { Command } from 'commander';
import yaml from 'js-yaml';
import { getConfig, saveConfig, getDefaultConfig, ensureVaultExists, paths } from '../vault.js';

export const configCommand = new Command('config')
  .description('View or modify configuration')
  .argument('[key]', 'Configuration key to set (e.g., "target")')
  .argument('[value]', 'Value to set')
  .action((key?: string, value?: string) => {
    ensureVaultExists();
    let config = getConfig();

    if (!config) {
      config = getDefaultConfig();
      saveConfig(config);
    }

    if (!key) {
      // Show full config
      console.log(yaml.dump(config, { lineWidth: -1 }));
      return;
    }

    if (!value) {
      // Show specific setting
      if (key === 'target') {
        console.log(config.settings.monthly_target);
      } else if (key === 'timezone') {
        console.log(config.settings.timezone);
      } else if (key === 'sync_days') {
        console.log(config.settings.sync_days);
      } else {
        console.error(`Unknown config key: ${key}`);
        console.error('Available keys: target, timezone, sync_days');
        process.exit(1);
      }
      return;
    }

    // Set a value
    if (key === 'target') {
      const target = parseInt(value, 10);
      if (isNaN(target) || target <= 0) {
        console.error('Target must be a positive number');
        process.exit(1);
      }
      config.settings.monthly_target = target;
      saveConfig(config);
      console.log(`Monthly target set to $${target.toLocaleString()}`);
    } else if (key === 'timezone') {
      config.settings.timezone = value;
      saveConfig(config);
      console.log(`Timezone set to ${value}`);
    } else if (key === 'sync_days') {
      const days = parseInt(value, 10);
      if (isNaN(days) || days <= 0) {
        console.error('Sync days must be a positive number');
        process.exit(1);
      }
      config.settings.sync_days = days;
      saveConfig(config);
      console.log(`Sync days set to ${days}`);
    } else {
      console.error(`Unknown config key: ${key}`);
      console.error('Available keys: target, timezone, sync_days');
      process.exit(1);
    }
  });
