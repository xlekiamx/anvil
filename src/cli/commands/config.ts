import * as fs from 'node:fs/promises';
import { Command } from 'commander';
import { GlobalConfigManager } from '../../files/global-config.js';
import { ConfigSchema } from '../../types/config.js';
import { printSuccess, printError, printInfo } from '../output.js';

export async function listConfigs(manager: GlobalConfigManager): Promise<string[]> {
  return manager.list();
}

export async function addConfig(manager: GlobalConfigManager, name: string, fromPath: string): Promise<void> {
  const content = await fs.readFile(fromPath, 'utf-8');
  const data = JSON.parse(content) as unknown;
  const result = ConfigSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid config: ${issues.join('; ')}`);
  }
  await manager.write(name, result.data);
}

export async function removeConfig(manager: GlobalConfigManager, name: string): Promise<void> {
  await manager.remove(name);
}

export function createConfigCommand(): Command {
  const cmd = new Command('config')
    .description('Manage global configs in ~/.anvil/configs/');

  cmd
    .command('list')
    .description('List global configs')
    .action(async () => {
      try {
        const manager = new GlobalConfigManager();
        const names = await listConfigs(manager);
        if (names.length === 0) {
          printInfo('No global configs found');
        } else {
          for (const name of names) {
            console.log(`  ${name}`);
          }
        }
      } catch (error) {
        printError(`Failed to list configs: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('add <name>')
    .description('Add a config to global configs')
    .requiredOption('--from <path>', 'Path to config JSON file')
    .action(async (name: string, options: { from: string }) => {
      try {
        const manager = new GlobalConfigManager();
        await addConfig(manager, name, options.from);
        printSuccess(`Added global config: ${name}`);
      } catch (error) {
        printError(`Failed to add config: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  cmd
    .command('remove <name>')
    .description('Remove a global config')
    .action(async (name: string) => {
      try {
        const manager = new GlobalConfigManager();
        await removeConfig(manager, name);
        printSuccess(`Removed global config: ${name}`);
      } catch (error) {
        printError(`Failed to remove config: ${(error as Error).message}`);
        process.exit(1);
      }
    });

  return cmd;
}
