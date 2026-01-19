import { Command } from 'commander';
import { createAnvilContext } from '../../core/factory.js';
import { printSuccess, printError, printInfo } from '../output.js';

export function createStopCommand(): Command {
  return new Command('stop')
    .description('Stop the orchestration loop and mark as blocked')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .option('-r, --reason <reason>', 'Reason for stopping', 'Manual stop')
    .action(async (options: { path: string; reason: string }) => {
      try {
        const context = createAnvilContext(options.path);

        // Check if initialized
        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        const status = await context.statusFile.read();

        if (!status) {
          printInfo('No active session.');
          return;
        }

        if (status.done) {
          printInfo('Session already completed.');
          return;
        }

        if (status.status === 'blocked') {
          printInfo('Session already blocked.');
          return;
        }

        // Update status to blocked
        await context.statusFile.update({
          status: 'blocked',
          blocked_reason: options.reason,
        });

        printSuccess(`Session stopped: ${options.reason}`);
        printInfo('Run "anvil start --resume" to continue.');
      } catch (error) {
        printError(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
