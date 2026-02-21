import { Command } from 'commander';
import { createInitCommand } from './commands/init.js';
import { createStartCommand } from './commands/start.js';
import { createStatusCommand } from './commands/status.js';
import { createStopCommand } from './commands/stop.js';
import { createResumeCommand } from './commands/resume.js';
import { createResetCommand } from './commands/reset.js';
import { createConfigCommand } from './commands/config.js';

export function createCli(): Command {
  const program = new Command();

  program
    .name('anvil')
    .description('Local multi-agent dev/review orchestration CLI')
    .version('0.1.0');

  program.addCommand(createInitCommand());
  program.addCommand(createStartCommand());
  program.addCommand(createStatusCommand());
  program.addCommand(createStopCommand());
  program.addCommand(createResumeCommand());
  program.addCommand(createResetCommand());
  program.addCommand(createConfigCommand());

  return program;
}
