import { readFileSync } from 'node:fs';
import type { WorkerConfig } from '../types/config.js';

export interface PromptContext {
  workerConfig: WorkerConfig;
  planFile: string;
  stateFile: string;
}

export function buildPrompt(ctx: PromptContext): string {
  const parts: string[] = [];

  // Prompt base: from prompt_file if set and exists, otherwise role
  if (ctx.workerConfig.prompt_file) {
    try {
      const content = readFileSync(ctx.workerConfig.prompt_file, 'utf-8');
      parts.push(content);
    } catch {
      // Fall back to role if prompt file not found
      parts.push(ctx.workerConfig.role);
    }
  } else {
    parts.push(ctx.workerConfig.role);
  }
  parts.push('');

  // Workers must never modify the state file
  parts.push(`IMPORTANT: Do NOT modify the state file at ${ctx.stateFile}. It is read-only. Only read it for context.`);
  parts.push('');

  // File paths for workers to read
  parts.push(`Plan file: ${ctx.planFile}`);
  parts.push(`State file: ${ctx.stateFile}`);
  parts.push('');

  // Output hint
  if (ctx.workerConfig.output_schema && Object.keys(ctx.workerConfig.output_schema).length > 0) {
    const schemaJson = JSON.stringify(ctx.workerConfig.output_schema);
    parts.push(`When done, respond with a JSON object matching: ${schemaJson}`);
  }

  return parts.join('\n');
}
