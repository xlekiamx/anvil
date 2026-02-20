import { describe, it, expect } from 'vitest';
import {
  WorkerConfigSchema,
  ConfigSchema,
  getDefaultConfig,
} from '../../src/types/config.js';
import {
  StatusSchema,
  createInitialStatus,
} from '../../src/types/status.js';

describe('WorkerConfigSchema behavior field', () => {
  it('accepts executor behavior', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
      behavior: 'executor',
    });
    expect(result.behavior).toBe('executor');
  });

  it('accepts reviewer behavior', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
      behavior: 'reviewer',
    });
    expect(result.behavior).toBe('reviewer');
  });

  it('defaults behavior to executor when omitted', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
    });
    expect(result.behavior).toBe('executor');
  });

  it('rejects invalid behavior value', () => {
    expect(() =>
      WorkerConfigSchema.parse({
        provider: 'mock',
        role: 'test role',
        behavior: 'invalid',
      })
    ).toThrow();
  });
});

describe('getDefaultConfig behavior', () => {
  it('returns coder with executor behavior', () => {
    const config = getDefaultConfig();
    expect(config.workers.coder!.behavior).toBe('executor');
  });

  it('returns reviewer with reviewer behavior', () => {
    const config = getDefaultConfig();
    expect(config.workers.reviewer!.behavior).toBe('reviewer');
  });
});

describe('WorkerConfigSchema prompt_file field', () => {
  it('accepts prompt_file string', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
      prompt_file: './prompts/coder.md',
    });
    expect(result.prompt_file).toBe('./prompts/coder.md');
  });

  it('works without prompt_file (optional)', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
    });
    expect(result.prompt_file).toBeUndefined();
  });
});

describe('getDefaultConfig prompt_file and behavior', () => {
  it('coder has prompt_file set', () => {
    const config = getDefaultConfig();
    expect(config.workers.coder!.prompt_file).toBe('./prompts/coder.md');
  });

  it('reviewer has prompt_file set', () => {
    const config = getDefaultConfig();
    expect(config.workers.reviewer!.prompt_file).toBe('./prompts/code-reviewer.md');
  });
});

describe('ConfigFile naming', () => {
  it('uses config.json by default', async () => {
    // ConfigFile with no name should use 'config.json'
    const { ConfigFile } = await import('../../src/files/config.js');
    const { createLogger } = await import('../../src/logger/index.js');
    const logger = createLogger({ level: 'silent' });
    const cf = new ConfigFile('/tmp/test-ai', logger);
    expect(cf.path).toBe('/tmp/test-ai/config.json');
  });

  it('uses config.<name>.json when name is provided', async () => {
    const { ConfigFile } = await import('../../src/files/config.js');
    const { createLogger } = await import('../../src/logger/index.js');
    const logger = createLogger({ level: 'silent' });
    const cf = new ConfigFile('/tmp/test-ai', logger, 'planning');
    expect(cf.path).toContain('config.planning.json');
  });
});

describe('StatusSchema feedback field', () => {
  it('accepts feedback field', () => {
    const result = StatusSchema.parse({
      plan_file: './PLAN.md',
      turn: 'coder',
      current_task: null,
      feedback: [{ description: 'fix this', severity: 'high' }],
      completed_tasks: [],
      iteration: 0,
      done: false,
      human_required: false,
      blocked_reason: null,
      pending_question: null,
      updated_at: new Date().toISOString(),
    });
    expect(result.feedback).toHaveLength(1);
    expect(result.feedback[0]!.description).toBe('fix this');
  });

  it('defaults feedback to empty array', () => {
    const result = StatusSchema.parse({
      plan_file: './PLAN.md',
      turn: 'coder',
      current_task: null,
      completed_tasks: [],
      iteration: 0,
      done: false,
      human_required: false,
      blocked_reason: null,
      pending_question: null,
      updated_at: new Date().toISOString(),
    });
    expect(result.feedback).toEqual([]);
  });

  it('createInitialStatus returns empty feedback array', () => {
    const status = createInitialStatus('./PLAN.md', 'coder');
    expect(status.feedback).toEqual([]);
  });
});
