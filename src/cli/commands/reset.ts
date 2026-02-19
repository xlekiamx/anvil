import { Command } from 'commander';
import { createAnvilContext } from '../../core/factory.js';
import { printSuccess, printError } from '../output.js';

export function createResetCommand(): Command {
  return new Command('reset')
    .description('Reset state to initial (keeps config and plan)')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .action(async (options: { path: string }) => {
      try {
        const context = createAnvilContext(options.path);

        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        const config = await context.configFile.read();
        const firstWorker = config.workflow[0]!;

        await context.statusFile.initialize(config.plan_file, firstWorker);
        printSuccess('State reset to initial');
      } catch (error) {
        printError(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
