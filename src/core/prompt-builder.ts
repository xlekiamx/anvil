import type { WorkerConfig } from '../types/config.js';
import type { Status } from '../types/status.js';

export interface PromptContext {
  workerConfig: WorkerConfig;
  state: Status;
  planFile: string;
  stateFile: string;
  isFirstWorker: boolean;
}

export function buildPrompt(ctx: PromptContext): string {
  const parts: string[] = [];

  // Role
  parts.push(ctx.workerConfig.role);
  parts.push('');

  // Workers must never modify the state file
  parts.push(`IMPORTANT: Do NOT modify the state file at ${ctx.stateFile}. It is read-only. Only read it for context.`);
  parts.push('');

  if (ctx.isFirstWorker) {
    // Coder prompt
    parts.push(`Read the plan file at ${ctx.planFile} for the task list.`);
    parts.push(`Read the state file at ${ctx.stateFile} for completed tasks and review issues.`);
    parts.push('');

    if (ctx.state.current_task?.status === 'fixing') {
      parts.push(`You are fixing task ${ctx.state.current_task.id}. Read the review issues from the state file and address them.`);
    } else {
      parts.push('Pick exactly 1 uncompleted task from the plan. Do NOT pick tasks already in completed_tasks in the state file.');
      parts.push('Implement only that one task.');
    }
  } else {
    // Reviewer prompt
    parts.push(`Read the state file at ${ctx.stateFile} to get the current task being reviewed.`);
    parts.push(`Read the plan file at ${ctx.planFile} to get the task details for that task.`);
    parts.push('');
    parts.push('IMPORTANT: You are reviewing ONLY the current task from the state file. Do NOT flag other unimplemented tasks as issues. Only check whether the current task meets its own requirements from the plan.');
    parts.push('');
    parts.push('For completed_tasks in your response, list all task IDs (e.g. "task_1", "task_2") that are fully implemented in the codebase, including previously completed ones and the current task if it passes review.');
    parts.push('Set done=true only when ALL tasks from the plan are in your completed_tasks list.');
  }

  parts.push('');

  // Output hint
  if (ctx.workerConfig.output_schema && Object.keys(ctx.workerConfig.output_schema).length > 0) {
    const schemaJson = JSON.stringify(ctx.workerConfig.output_schema);
    parts.push(`When done, respond with a JSON object matching: ${schemaJson}`);
  }

  return parts.join('\n');
}
