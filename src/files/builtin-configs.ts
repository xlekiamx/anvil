import { ConfigSchema, type Config } from '../types/config.js';

const PLANNING_CONFIG = ConfigSchema.parse({
  workers: {
    planner: {
      provider: 'claude',
      role: 'You are an expert technical planner. Create and refine implementation plans.',
      behavior: 'executor',
      prompt_file: '~/.anvil/prompts/planner.md',
      interactive: true,
      output_schema: {
        task_id: 'string',
        task_description: 'string',
        status: 'completed | needs_review',
      },
    },
    'plan-reviewer': {
      provider: 'codex',
      role: 'You are a senior architect reviewing plans for completeness and correctness.',
      behavior: 'reviewer',
      prompt_file: '~/.anvil/prompts/plan-reviewer.md',
      output_schema: {
        approved: 'boolean',
        done: 'boolean',
        completed_tasks: ['string'],
        issues: [{ description: 'string', severity: 'critical | high | medium | low' }],
        confidence: 'number 0-1',
      },
    },
  },
  plan_file: './PLAN.md',
  workflow: ['planner', 'plan-reviewer'],
  loop_mode: 'auto',
  max_iterations_per_task: 6,
});

const builtins: Record<string, Config> = {
  planning: PLANNING_CONFIG,
};

export function getBuiltinConfig(name: string): Config | undefined {
  return builtins[name];
}

export function listBuiltinConfigs(): string[] {
  return Object.keys(builtins);
}
