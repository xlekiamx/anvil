import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Command } from 'commander';
import { createAnvilContext } from '../../core/factory.js';
import { printSuccess, printError, printInfo } from '../output.js';

const CODER_PROMPT = `You are a senior software engineer. Implement tasks from the plan.
Read the plan file for the task list. Read the state file for completed tasks and feedback.
If the current task in state has status 'fixing', address the feedback issues.
Otherwise, pick exactly 1 uncompleted task from the plan (not in completed_tasks) and implement it.
Implement only that one task. Write tests for your implementation.`;

const CODE_REVIEWER_PROMPT = `You are a staff software engineer reviewing changes for correctness, security, and quality.
Read the state file to get the current task. Read the plan file for task details.
Review ONLY the current task. Do not flag other unimplemented tasks as issues.
For completed_tasks, list all task IDs fully implemented in the codebase.
Set done=true only when ALL plan tasks are in completed_tasks.`;

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

          if (!hasConfig) {
            await context.configFile.initialize();
            printSuccess('Created config.json');
          }

          return;
        }

        // Create .ai directory
        await context.aiDir.create();
        printSuccess('Created .ai directory');

        // Initialize config with real workers
        const { ConfigSchema } = await import('../../types/config.js');
        const config = ConfigSchema.parse({
          workers: {
            coder: {
              provider: 'claude',
              role: 'You are a senior developer. Implement tasks from the plan.',
              behavior: 'executor',
              prompt_file: './prompts/coder.md',
              interactive: true,
              output_schema: {
                task_id: 'string',
                task_description: 'string',
                status: 'completed | needs_review',
              },
            },
            reviewer: {
              provider: 'codex',
              role: 'You are a code reviewer. Review changes for correctness, security, and quality.',
              behavior: 'reviewer',
              prompt_file: './prompts/code-reviewer.md',
              output_schema: {
                approved: 'boolean',
                done: 'boolean',
                completed_tasks: ['string'],
                issues: [{ description: 'string', severity: 'critical | high | medium | low' }],
                confidence: 'number 0-1',
              },
            },
          },
          plan_file: './PLAN.md',
          workflow: ['coder', 'reviewer'],
          loop_mode: 'auto',
          max_iterations_per_task: 6,
        });
        await context.configFile.write(config);
        printSuccess('Created config.json');

        // Create prompt files
        const promptsDir = path.join(options.path, 'prompts');
        await fs.mkdir(promptsDir, { recursive: true });
        await fs.writeFile(path.join(promptsDir, 'coder.md'), CODER_PROMPT, 'utf-8');
        await fs.writeFile(path.join(promptsDir, 'code-reviewer.md'), CODE_REVIEWER_PROMPT, 'utf-8');
        printSuccess('Created prompts/ directory with default prompt files');

        console.log('');
        printInfo('Next steps:');
        console.log('  1. Create a PLAN.md file with your tasks');
        console.log('  2. Run: anvil start');
      } catch (error) {
        printError(`Failed to initialize: ${(error as Error).message}`);
        process.exit(1);
      }
    });
}
