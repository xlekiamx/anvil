import { Command } from 'commander';
import ora from 'ora';
import { createAnvilContext, createOrchestrator } from '../../core/factory.js';
import { printError, printInfo, printSuccess, formatOrchestratorResult } from '../output.js';
import { promptUserForAnswer, displayPendingQuestion } from '../user-input.js';
import type { DetectedQuestion } from '../../agents/types.js';

export function createResumeCommand(): Command {
  return new Command('resume')
    .description('Resume orchestration from current state')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .action(async (options: { path: string }) => {
      const spinner = ora();

      try {
        const context = createAnvilContext(options.path);

        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        const status = await context.statusFile.read();
        const config = await context.configFile.read();

        if (!status) {
          printError('No state file found. Run "anvil start" first.');
          process.exit(1);
        }

        if (status.done) {
          printInfo('Session is already complete. Run "anvil start" for a new session.');
          return;
        }

        // Handle pending question first
        if (status.pending_question) {
          displayPendingQuestion(status.pending_question);

          const question: DetectedQuestion = {
            sessionId: status.pending_question.session_id,
            question: status.pending_question.question,
            options: status.pending_question.options,
          };

          const answer = await promptUserForAnswer(question);
          console.log('');
          printInfo(`Resuming with answer: "${answer}"`);

          await context.statusFile.update({ pending_question: null });
        }

        // Clear blocked states
        if (status.human_required) {
          // Reviewer flagged human intervention — send back to coder to fix
          const firstWorker = config.workflow[0]!;
          await context.statusFile.update({
            human_required: false,
            turn: firstWorker,
            current_task: status.current_task ? {
              ...status.current_task,
              status: 'fixing',
            } : null,
          });
          printSuccess('Cleared human intervention, sending back to coder');
        } else if (status.blocked_reason) {
          // Other block — just clear it and resume from current turn
          await context.statusFile.update({
            blocked_reason: null,
          });
          printSuccess('Cleared blocked state');
        }

        printInfo(`Resuming from turn: ${status.turn}, iteration: ${status.iteration}`);

        spinner.start('Running orchestration loop...');

        const firstWorkerConfig = config.workers[config.workflow[0]!];
        const isInteractive = firstWorkerConfig?.interactive && process.env.CI !== 'true';

        const orchestrator = createOrchestrator(context, config, {
          questionHandler: isInteractive ? async (q) => {
            spinner.stop();
            const ans = await promptUserForAnswer(q);
            spinner.start('Resuming with your answer...');
            return ans;
          } : undefined,
        });

        const result = await orchestrator.run();

        spinner.stop();
        console.log('');
        console.log(formatOrchestratorResult(result));

        if (!result.success) process.exit(1);
      } catch (error) {
        spinner.stop();
        printError(`Failed: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
