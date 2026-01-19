import { Command } from 'commander';
import { createAnvilContext } from '../../core/factory.js';
import { formatStatus, formatReviewOutput, printError, printInfo } from '../output.js';

export function createStatusCommand(): Command {
  return new Command('status')
    .description('Show current orchestration status')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .option('--json', 'Output as JSON')
    .action(async (options: { path: string; json?: boolean }) => {
      try {
        const context = createAnvilContext(options.path);

        // Check if initialized
        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        const status = await context.statusFile.read();

        if (!status) {
          printInfo('No active session. Run "anvil start" to begin.');
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }

        console.log(formatStatus(status));

        // Show review output if exists
        const reviewOutput = await context.reviewOutputFile.read();
        if (reviewOutput) {
          console.log('');
          console.log(formatReviewOutput(reviewOutput));
        }
      } catch (error) {
        printError(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
