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
              output_schema: {
                approved: 'boolean',
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
