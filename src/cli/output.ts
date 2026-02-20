import chalk from 'chalk';
import type { Status } from '../types/status.js';
import type { OrchestratorResult } from '../core/orchestrator.js';

export function formatStatus(status: Status): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Turn:') + ` ${status.turn}`);
  lines.push(chalk.bold('Iteration:') + ` ${status.iteration}`);

  if (status.current_task) {
    lines.push(chalk.bold('Current Task:') + ` [${status.current_task.id}] (${status.current_task.status})`);
  } else {
    lines.push(chalk.bold('Current Task:') + ` None`);
  }

  lines.push(chalk.bold('Completed Tasks:') + ` ${status.completed_tasks.length}`);
  if (status.completed_tasks.length > 0) {
    for (const taskId of status.completed_tasks) {
      lines.push(`  - [${taskId}]`);
    }
  }

  if (status.done) {
    lines.push(chalk.green.bold('Done: Yes'));
  }

  if (status.human_required) {
    lines.push(chalk.yellow.bold('Human Required: Yes'));
  }

  if (status.blocked_reason) {
    lines.push(chalk.red.bold('Blocked:') + ` ${status.blocked_reason}`);
  }

  if (status.feedback.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Feedback (${status.feedback.length}):`));
    for (const issue of status.feedback) {
      const severity = formatSeverity(issue.severity);
      lines.push(`  ${severity} ${issue.description}`);
    }
  }

  if (status.started_at) {
    lines.push(chalk.dim('Started:') + ` ${status.started_at}`);
  }
  lines.push(chalk.dim('Updated:') + ` ${status.updated_at}`);

  return lines.join('\n');
}

function formatSeverity(severity: string): string {
  switch (severity) {
    case 'critical':
      return chalk.bgRed.white(' CRITICAL ');
    case 'high':
      return chalk.red(' HIGH ');
    case 'medium':
      return chalk.yellow(' MEDIUM ');
    case 'low':
      return chalk.dim(' LOW ');
    default:
      return severity;
  }
}

export function formatOrchestratorResult(result: OrchestratorResult): string {
  const lines: string[] = [];

  if (result.success) {
    lines.push(chalk.green.bold('Orchestration completed successfully!'));
  } else {
    lines.push(chalk.red.bold('Orchestration stopped'));
  }

  lines.push('');
  lines.push(chalk.bold('Reason:') + ` ${result.reason}`);
  lines.push(chalk.bold('Total Iterations:') + ` ${result.totalIterations}`);
  lines.push('');
  lines.push(formatStatus(result.finalStatus));

  return lines.join('\n');
}

export function printSuccess(message: string): void {
  console.log(chalk.green('✓') + ' ' + message);
}

export function printError(message: string): void {
  console.error(chalk.red('✗') + ' ' + message);
}

export function printWarning(message: string): void {
  console.log(chalk.yellow('⚠') + ' ' + message);
}

export function printInfo(message: string): void {
  console.log(chalk.blue('ℹ') + ' ' + message);
}
