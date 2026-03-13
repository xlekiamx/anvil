import * as path from 'node:path';
import { Command } from 'commander';
import ora from 'ora';
import { createLogger } from '../../logger/index.js';
import { createAnvilContext, createOrchestrator, type AnvilContext } from '../../core/factory.js';
import type { Config } from '../../types/config.js';
import { printError, printInfo, printSuccess, formatOrchestratorResult } from '../output.js';
import { promptUserForAnswer, promptHumanGuidance, displayPendingQuestion } from '../user-input.js';
import type { DetectedQuestion } from '../../agents/types.js';
import type { ReviewIssue } from '../../types/status.js';

export interface ResumeSessionOptions {
  /** Injectable for testing — defaults to promptHumanGuidance */
  guidancePromptFn?: (issues: ReviewIssue[]) => Promise<string>;
}

export async function resumeSession(
  context: AnvilContext,
  config: Config,
  options: ResumeSessionOptions = {}
): Promise<void> {
  const status = await context.statusFile.read();

  if (!status) throw new Error('No state file found. Run "anvil start" first.');
  if (status.done) throw new Error('Session is already complete. Run "anvil start" for a new session.');

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
    const promptFn = options.guidancePromptFn ?? promptHumanGuidance;
    const guidance = await promptFn(status.feedback);

    const firstWorker = config.workflow[0]!;
    const updatedNotes = guidance
      ? [...status.notes, `Human guidance: ${guidance}`]
      : status.notes;

    await context.statusFile.update({
      human_required: false,
      turn: firstWorker,
      notes: updatedNotes,
      current_task: status.current_task ? {
        ...status.current_task,
        status: 'fixing',
      } : null,
    });
    printSuccess('Got your guidance, sending to coder');
  } else if (status.blocked_reason) {
    await context.statusFile.update({ blocked_reason: null });
    printSuccess('Cleared blocked state');
  }
}

export function createResumeCommand(): Command {
  return new Command('resume')
    .description('Resume orchestration from current state')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .option('-v, --verbose', 'Enable debug logging')
    .option('-c, --config <name>', 'Config name (loads .ai/config.<name>.json)')
    .action(async (options: { path: string; verbose?: boolean; config?: string }) => {
      const spinner = ora();

      try {
        const logFile = options.verbose ? path.join(options.path, '.ai', 'anvil.log') : undefined;
        const logger = createLogger({ level: options.verbose ? 'debug' : 'info', logFile });
        const context = createAnvilContext(options.path, logger, options.config);

        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        const config = await context.configFile.read();
        const status = await context.statusFile.read();

        if (!status) {
          printError('No state file found. Run "anvil start" first.');
          process.exit(1);
        }

        if (status.done) {
          printInfo('Session is already complete. Run "anvil start" for a new session.');
          return;
        }

        await resumeSession(context, config);

        const updatedStatus = await context.statusFile.read();
        printInfo(`Resuming from turn: ${updatedStatus!.turn}, iteration: ${updatedStatus!.iteration}`);

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
