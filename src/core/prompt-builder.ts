import type { WorkerConfig } from '../types/config.js';
import type { Status } from '../types/status.js';

export interface PromptContext {
  workerConfig: WorkerConfig;
  state: Status;
  planContent: string;
  gitDiff?: string;
}

export function buildPrompt(ctx: PromptContext): string {
  const parts: string[] = [];

  // Role
  parts.push('## Role');
  parts.push(ctx.workerConfig.role);
  parts.push('');

  // Plan content
  parts.push('## Plan');
  parts.push(ctx.planContent);
  parts.push('');

  // State context
  parts.push('## Current State');
  if (ctx.state.current_task) {
    parts.push(`Current task: [${ctx.state.current_task.id}] (${ctx.state.current_task.status})`);
    if (ctx.state.current_task.status === 'fixing') {
      parts.push('');
      parts.push('IMPORTANT: You are fixing this task based on reviewer feedback. Address the review issues below and re-implement.');
    }
  } else {
    parts.push('Pick the next incomplete task from the plan that is not already completed.');
    parts.push('Implement just that one task.');
  }

  if (ctx.state.completed_tasks.length > 0) {
    parts.push('');
    parts.push('Already completed (do NOT pick these):');
    for (const taskId of ctx.state.completed_tasks) {
      parts.push(`- [${taskId}]`);
    }
  }

  if (ctx.state.review_issues.length > 0) {
    parts.push('');
    parts.push('Review issues to address:');
    for (const issue of ctx.state.review_issues) {
      parts.push(`- [${issue.severity.toUpperCase()}] ${issue.description}`);
    }
  }
  parts.push('');

  // Git diff (for reviewer)
  if (ctx.gitDiff) {
    parts.push('## Git Diff');
    parts.push(ctx.gitDiff);
    parts.push('');
  }

  // Output hint — lightweight, the schema enforcement happens at the provider level where possible
  if (ctx.workerConfig.output_schema && Object.keys(ctx.workerConfig.output_schema).length > 0) {
    const schemaJson = JSON.stringify(ctx.workerConfig.output_schema);
    parts.push(`When done, respond with a JSON object matching: ${schemaJson}`);
  }

  return parts.join('\n');
}
