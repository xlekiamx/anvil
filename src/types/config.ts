import { z } from 'zod';

export const ProviderSchema = z.enum(['mock', 'claude', 'codex']);
export type Provider = z.infer<typeof ProviderSchema>;

export const LoopModeSchema = z.enum(['auto', 'manual']);
export type LoopMode = z.infer<typeof LoopModeSchema>;

export const WorkerConfigSchema = z.object({
  provider: ProviderSchema,
  role: z.string().min(1),
  model: z.string().optional(),
  interactive: z.boolean().default(false),
  output_schema: z.record(z.unknown()).default({}),
});
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export const ConfigSchema = z.object({
  workers: z.record(WorkerConfigSchema).default({
    coder: {
      provider: 'mock',
      role: 'You are a senior developer. Implement tasks from the plan.',
      output_schema: {
        task_id: 'string',
        status: 'completed | needs_review',
      },
    },
    reviewer: {
      provider: 'mock',
      role: 'You are a code reviewer. Review changes for correctness, security, and quality.',
      output_schema: {
        approved: 'boolean',
        done: 'boolean',
        completed_tasks: ['string'],
        issues: [{ description: 'string', severity: 'critical | high | medium | low' }],
        confidence: 'number 0-1',
      },
    },
  }),
  plan_file: z.string().default('./PLAN.md'),
  workflow: z.array(z.string()).min(1).default(['coder', 'reviewer']),
  loop_mode: LoopModeSchema.default('auto'),
  max_iterations_per_task: z.number().int().min(1).max(50).default(6),
});
export type Config = z.infer<typeof ConfigSchema>;

export function getDefaultConfig(): Config {
  return ConfigSchema.parse({});
}
