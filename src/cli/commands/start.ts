import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { createLogger } from '../../logger/index.js';
import { createAnvilContext, createOrchestrator } from '../../core/factory.js';
import { printSuccess, printError, printInfo, formatOrchestratorResult } from '../output.js';
import { promptUserForAnswer } from '../user-input.js';

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start the dev/review orchestration loop')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .option('--resume', 'Resume from blocked state')
    .option('-v, --verbose', 'Enable debug logging')
    .option('-c, --config <name>', 'Config name (loads .ai/config.<name>.json)')
    .action(async (options: { path: string; resume?: boolean; verbose?: boolean; config?: string }) => {
      const spinner = ora();

      try {
        const logFile = options.verbose ? path.join(options.path, '.ai', 'anvil.log') : undefined;
        const logger = createLogger({ level: options.verbose ? 'debug' : 'info', logFile });
        const context = createAnvilContext(options.path, logger, options.config);

        // Check if initialized
        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        // Load config and status
        let status = await context.statusFile.read();
        const config = await context.configFile.read();

        // Validate plan file exists
        const planPath = path.resolve(options.path, config.plan_file);
        try {
          await fs.access(planPath);
        } catch {
          printError(`Plan file not found: ${config.plan_file}`);
          printInfo('Create your plan file or update plan_file in .ai/config.json');
          process.exit(1);
        }

        if (options.resume) {
          if (!status) {
            printError('No state file found. Cannot resume.');
            process.exit(1);
          }

          if (!status.blocked_reason && !status.human_required) {
            printError(`Cannot resume: not blocked`);
            process.exit(1);
          }

          status = await context.statusFile.update({
            human_required: false,
            blocked_reason: null,
          });

          printSuccess('Resumed from blocked state');
        } else if (status && !status.done && !status.blocked_reason) {
          // Existing active session
          printInfo(`Continuing existing session (turn: ${status.turn})`);
        } else {
          // New session
          const firstWorker = config.workflow[0]!;
          status = await context.statusFile.initialize(config.plan_file, firstWorker);
          printSuccess(`Started new session (first worker: ${firstWorker})`);
        }

        // Determine if interactive
        const firstWorkerConfig = config.workers[config.workflow[0]!];
        const isInteractive = firstWorkerConfig?.interactive && process.env.CI !== 'true';

        spinner.start('Running orchestration loop...');

        const orchestrator = createOrchestrator(context, config, {
          questionHandler: isInteractive ? async (question) => {
            spinner.stop();
            const answer = await promptUserForAnswer(question);
            spinner.start('Resuming with your answer...');
            return answer;
          } : undefined,
        });
        const result = await orchestrator.run();

        spinner.stop();

        console.log('');
        console.log(formatOrchestratorResult(result));

        if (!result.success) {
          process.exit(1);
        }
      } catch (error) {
        spinner.stop();
        printError(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
