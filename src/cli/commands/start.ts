import { Command } from 'commander';
import ora from 'ora';
import { createAnvilContext, createOrchestrator } from '../../core/factory.js';
import { printSuccess, printError, printInfo, formatOrchestratorResult } from '../output.js';

function generateFeatureId(feature: string): string {
  return feature
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function createStartCommand(): Command {
  return new Command('start')
    .description('Start the dev/review orchestration loop')
    .argument('[feature]', 'Feature description (optional, uses .ai/SPEC.md if not provided)')
    .option('-p, --path <path>', 'Repository path', process.cwd())
    .option('--resume', 'Resume from blocked state')
    .action(async (feature: string | undefined, options: { path: string; resume?: boolean }) => {
      const spinner = ora();

      try {
        const context = createAnvilContext(options.path);

        // Check if initialized
        if (!(await context.aiDir.exists())) {
          printError('.ai directory not found. Run "anvil init" first.');
          process.exit(1);
        }

        // Load or create status
        let status = await context.statusFile.read();
        const config = await context.configFile.read();

        if (options.resume) {
          if (!status) {
            printError('No status file found. Cannot resume.');
            process.exit(1);
          }

          if (status.status !== 'blocked') {
            printError(`Cannot resume: status is '${status.status}', expected 'blocked'`);
            process.exit(1);
          }

          // Resume from blocked
          status = await context.statusFile.update({
            status: 'needs_fix',
            human_required: false,
            blocked_reason: undefined,
          });

          printSuccess('Resumed from blocked state');
        } else if (status && !status.done && status.status !== 'blocked') {
          // Existing active session
          printInfo(`Continuing existing session for feature: ${status.feature_id}`);
        } else {
          // New session
          if (feature) {
            // Write feature to SPEC.md
            const specContent = `# Feature: ${feature}\n\n## Requirements\n\n${feature}\n\n## Acceptance Criteria\n\n- [ ] Feature implemented as described\n`;
            await context.specFile.write(specContent);
            printSuccess(`Feature written to SPEC.md`);
          }

          // Check SPEC.md exists
          const specContent = await context.specFile.read();
          if (!specContent) {
            printError('No SPEC.md found. Create one or pass a feature description.');
            process.exit(1);
          }

          // Generate feature ID
          const featureId = feature
            ? generateFeatureId(feature)
            : `feature-${Date.now()}`;

          // Initialize status
          status = await context.statusFile.initialize(featureId);
          printSuccess(`Started new session: ${featureId}`);
        }

        // Create and run orchestrator
        spinner.start('Running orchestration loop...');

        const orchestrator = createOrchestrator(context, config);
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
