import { describe, it, expect } from 'vitest';
import { ConfigSchema } from '../../src/types/config.js';
import { getBuiltinConfig, listBuiltinConfigs } from '../../src/files/builtin-configs.js';
import { getBuiltinPrompt } from '../../src/files/prompt-templates.js';

describe('getBuiltinConfig', () => {
  it('returns valid Config for "planning"', () => {
    const config = getBuiltinConfig('planning');
    expect(config).toBeDefined();
    const result = ConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('planning config has planner (executor) + plan-reviewer (reviewer)', () => {
    const config = getBuiltinConfig('planning')!;
    expect(config.workers.planner).toBeDefined();
    expect(config.workers.planner!.behavior).toBe('executor');
    expect(config.workers['plan-reviewer']).toBeDefined();
    expect(config.workers['plan-reviewer']!.behavior).toBe('reviewer');
  });

  it('planning config passes ConfigSchema validation', () => {
    const config = getBuiltinConfig('planning')!;
    expect(() => ConfigSchema.parse(config)).not.toThrow();
  });

  it('planning config workflow is [planner, plan-reviewer]', () => {
    const config = getBuiltinConfig('planning')!;
    expect(config.workflow).toEqual(['planner', 'plan-reviewer']);
  });

  it('returns undefined for nonexistent config', () => {
    expect(getBuiltinConfig('nonexistent')).toBeUndefined();
  });
});

describe('listBuiltinConfigs', () => {
  it('includes "planning"', () => {
    expect(listBuiltinConfigs()).toContain('planning');
  });
});

describe('getBuiltinPrompt', () => {
  it('returns string for "planner"', () => {
    const prompt = getBuiltinPrompt('planner');
    expect(typeof prompt).toBe('string');
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it('returns string for "plan-reviewer"', () => {
    const prompt = getBuiltinPrompt('plan-reviewer');
    expect(typeof prompt).toBe('string');
    expect(prompt!.length).toBeGreaterThan(0);
  });

  it('returns undefined for nonexistent prompt', () => {
    expect(getBuiltinPrompt('nonexistent')).toBeUndefined();
  });
});
