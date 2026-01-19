import chalk from 'chalk';
import type { Status } from '../types/status.js';
import type { ReviewOutput } from '../types/review.js';
import type { OrchestratorResult } from '../core/orchestrator.js';

export function formatStatus(status: Status): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Feature:') + ` ${status.feature_id}`);
  lines.push(chalk.bold('Status:') + ` ${formatStatusBadge(status.status)}`);
  lines.push(chalk.bold('Iteration:') + ` ${status.iteration}`);
  lines.push(chalk.bold('Last Actor:') + ` ${status.last_actor}`);

  if (status.done) {
    lines.push(chalk.green.bold('Done: Yes'));
  }

  if (status.human_required) {
    lines.push(chalk.yellow.bold('Human Required: Yes'));
  }

  if (status.blocked_reason) {
    lines.push(chalk.red.bold('Blocked Reason:') + ` ${status.blocked_reason}`);
  }

  if (status.annotations) {
    lines.push(chalk.bold('Annotations:') + ` ${status.annotations}`);
  }

  if (status.started_at) {
    lines.push(chalk.dim('Started:') + ` ${status.started_at}`);
  }

  lines.push(chalk.dim('Updated:') + ` ${status.updated_at}`);

  return lines.join('\n');
}

export function formatStatusBadge(status: string): string {
  switch (status) {
    case 'needs_fix':
      return chalk.yellow(status);
    case 'needs_review':
      return chalk.blue(status);
    case 'done':
      return chalk.green(status);
    case 'blocked':
      return chalk.red(status);
    default:
      return status;
  }
}

export function formatReviewOutput(review: ReviewOutput): string {
  const lines: string[] = [];

  lines.push(chalk.bold('Review Result'));
  lines.push(
    chalk.bold('Approved:') +
      ` ${review.approved ? chalk.green('Yes') : chalk.red('No')}`
  );
  lines.push(chalk.bold('Confidence:') + ` ${(review.confidence * 100).toFixed(0)}%`);
  lines.push(chalk.bold('Summary:') + ` ${review.summary}`);

  if (review.issues.length > 0) {
    lines.push('');
    lines.push(chalk.bold(`Issues (${review.issues.length}):`));
    for (const issue of review.issues) {
      const severity = formatSeverity(issue.severity);
      const location = issue.file
        ? ` (${issue.file}${issue.line ? `:${issue.line}` : ''})`
        : '';
      lines.push(`  ${severity} [${issue.category}] ${issue.description}${location}`);
    }
  }

  if (review.request_human) {
    lines.push('');
    lines.push(chalk.yellow.bold('Human intervention requested'));
  }

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
