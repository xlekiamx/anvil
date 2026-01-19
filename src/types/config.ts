import { z } from 'zod';

export const TriggerModeSchema = z.enum(['manual', 'watch', 'daemon']);
export type TriggerMode = z.infer<typeof TriggerModeSchema>;

export const IssueCategorySchema = z.enum([
  'security',
  'correctness',
  'performance',
  'maintainability',
  'architecture',
]);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const AgentTypeSchema = z.enum(['mock', 'claude', 'codex']);
export type AgentType = z.infer<typeof AgentTypeSchema>;

export const ConfigSchema = z.object({
  max_iterations: z.number().int().min(1).max(20).default(6),
  trigger: z
    .object({
      mode: TriggerModeSchema.default('manual'),
      watch_paths: z.array(z.string()).default(['.ai/SPEC.md']),
      interval_seconds: z.number().int().min(60).default(300),
    })
    .default({}),
  tests: z
    .object({
      enabled: z.boolean().default(false),
      command: z.string().default('npm test'),
      required_to_pass: z.boolean().default(false),
    })
    .default({}),
  human_required_on: z
    .object({
      security_issues: z.boolean().default(true),
      low_confidence_threshold: z.number().min(0).max(1).default(0.6),
      categories: z.array(IssueCategorySchema).default(['security', 'architecture']),
    })
    .default({}),
  agents: z
    .object({
      developer: z
        .object({
          type: z.enum(['mock', 'claude']).default('mock'),
          timeout_seconds: z.number().default(300),
        })
        .default({}),
      reviewer: z
        .object({
          type: z.enum(['mock', 'codex']).default('mock'),
          timeout_seconds: z.number().default(120),
        })
        .default({}),
    })
    .default({}),
});
export type Config = z.infer<typeof ConfigSchema>;

export function getDefaultConfig(): Config {
  return ConfigSchema.parse({});
}
