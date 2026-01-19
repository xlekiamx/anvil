import { Command } from 'commander';
import { createAnvilContext } from '../../core/factory.js';
import { printSuccess, printError, printInfo } from '../output.js';

export function createInitCommand(): Command {
  return new Command('init')
    .description('Initialize .ai directory for orchestration')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .action(async (options: { path: string }) => {
      try {
        const context = createAnvilContext(options.path);

        // Check if already initialized
        if (await context.aiDir.exists()) {
          printInfo('.ai directory already exists');

          const hasConfig = await context.configFile.exists();
          const hasSpec = await context.specFile.exists();

          if (!hasConfig) {
            await context.configFile.initialize();
            printSuccess('Created config.json');
          }

          if (!hasSpec) {
            await context.specFile.initialize();
            printSuccess('Created SPEC.md');
          }

          return;
        }

        // Create .ai directory
        await context.aiDir.create();
        printSuccess('Created .ai directory');

        // Initialize files
        await context.configFile.initialize();
        printSuccess('Created config.json');

        await context.specFile.initialize();
        printSuccess('Created SPEC.md');

        console.log('');
        printInfo('Next steps:');
        console.log('  1. Edit .ai/SPEC.md to define your feature');
        console.log('  2. Run: anvil start');
      } catch (error) {
        printError(`Failed to initialize: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
