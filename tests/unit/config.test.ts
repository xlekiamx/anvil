import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  WorkerConfigSchema,
  ConfigSchema,
  getDefaultConfig,
} from '../../src/types/config.js';
import {
  StatusSchema,
  createInitialStatus,
} from '../../src/types/status.js';
import { ConfigFile } from '../../src/files/config.js';
import { GlobalConfigManager } from '../../src/files/global-config.js';
import { createLogger } from '../../src/logger/index.js';
import { getBuiltinConfig } from '../../src/files/builtin-configs.js';

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

describe('StatusSchema notes field', () => {
  it('accepts notes array', () => {
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
      notes: ['Chose library X', 'Used pattern Y'],
    });
    expect(result.notes).toEqual(['Chose library X', 'Used pattern Y']);
  });

  it('defaults notes to empty array', () => {
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
    expect(result.notes).toEqual([]);
  });

  it('createInitialStatus returns empty notes', () => {
    const status = createInitialStatus('./PLAN.md', 'coder');
    expect(status.notes).toEqual([]);
  });
});

describe('StatusSchema batch_pending_review field', () => {
  it('accepts batch_pending_review true', () => {
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
      batch_pending_review: true,
    });
    expect(result.batch_pending_review).toBe(true);
  });

  it('defaults batch_pending_review to false', () => {
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
    expect(result.batch_pending_review).toBe(false);
  });

  it('createInitialStatus returns batch_pending_review false', () => {
    const status = createInitialStatus('./PLAN.md', 'coder');
    expect(status.batch_pending_review).toBe(false);
  });
});

describe('StatusSchema parse_error_count field', () => {
  it('accepts parse_error_count', () => {
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
      parse_error_count: 2,
    });
    expect(result.parse_error_count).toBe(2);
  });

  it('defaults parse_error_count to 0', () => {
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
    expect(result.parse_error_count).toBe(0);
  });

  it('createInitialStatus returns parse_error_count 0', () => {
    const status = createInitialStatus('./PLAN.md', 'coder');
    expect(status.parse_error_count).toBe(0);
  });
});

describe('ConfigSchema review_strategy field', () => {
  it('accepts review_strategy per_task', () => {
    const result = ConfigSchema.parse({ review_strategy: 'per_task' });
    expect(result.review_strategy).toBe('per_task');
  });

  it('accepts review_strategy batch', () => {
    const result = ConfigSchema.parse({ review_strategy: 'batch' });
    expect(result.review_strategy).toBe('batch');
  });

  it('defaults review_strategy to per_task', () => {
    const result = ConfigSchema.parse({});
    expect(result.review_strategy).toBe('per_task');
  });

  it('rejects invalid review_strategy', () => {
    expect(() => ConfigSchema.parse({ review_strategy: 'invalid' })).toThrow();
  });
});

describe('ConfigSchema auto_commit field', () => {
  it('defaults auto_commit to true', () => {
    const result = ConfigSchema.parse({});
    expect(result.auto_commit).toBe(true);
  });

  it('accepts auto_commit false', () => {
    const result = ConfigSchema.parse({ auto_commit: false });
    expect(result.auto_commit).toBe(false);
  });
});

describe('ConfigSchema human_intervention field', () => {
  it('accepts human_intervention false', () => {
    const result = ConfigSchema.parse({ human_intervention: false });
    expect(result.human_intervention).toBe(false);
  });

  it('accepts human_intervention true', () => {
    const result = ConfigSchema.parse({ human_intervention: true });
    expect(result.human_intervention).toBe(true);
  });

  it('defaults human_intervention to true', () => {
    const result = ConfigSchema.parse({});
    expect(result.human_intervention).toBe(true);
  });
});

describe('WorkerConfigSchema sandbox field', () => {
  it('accepts sandbox string', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'codex',
      role: 'test role',
      sandbox: 'read-only',
    });
    expect(result.sandbox).toBe('read-only');
  });

  it('works without sandbox (optional)', () => {
    const result = WorkerConfigSchema.parse({
      provider: 'mock',
      role: 'test role',
    });
    expect(result.sandbox).toBeUndefined();
  });
});

describe('ConfigSchema parse_error_retries field', () => {
  it('accepts parse_error_retries', () => {
    const result = ConfigSchema.parse({ parse_error_retries: 5 });
    expect(result.parse_error_retries).toBe(5);
  });

  it('defaults parse_error_retries to 3', () => {
    const result = ConfigSchema.parse({});
    expect(result.parse_error_retries).toBe(3);
  });
});

describe('ConfigFile resolution fallback', () => {
  let tmpDir: string;
  let aiDir: string;
  let globalDir: string;
  let logger: ReturnType<typeof createLogger>;
  let globalManager: GlobalConfigManager;

  const localConfig = ConfigSchema.parse({
    workers: {
      local: { provider: 'mock', role: 'local worker', behavior: 'executor' },
    },
    workflow: ['local'],
  });

  const globalConfig = ConfigSchema.parse({
    workers: {
      global: { provider: 'mock', role: 'global worker', behavior: 'executor' },
    },
    workflow: ['global'],
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-config-'));
    aiDir = path.join(tmpDir, '.ai');
    globalDir = path.join(tmpDir, 'global-anvil');
    await fs.mkdir(aiDir, { recursive: true });
    logger = createLogger({ level: 'silent' });
    globalManager = new GlobalConfigManager(globalDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('local config takes precedence over global', async () => {
    // Write both local and global
    const cf = new ConfigFile(aiDir, logger, 'planning', globalManager);
    await fs.writeFile(
      path.join(aiDir, 'config.planning.json'),
      JSON.stringify(localConfig),
      'utf-8'
    );
    await globalManager.write('planning', globalConfig);

    const config = await cf.read();
    expect(config.workers.local).toBeDefined();
    expect(config.workers.global).toBeUndefined();
  });

  it('falls back to global when local missing', async () => {
    await globalManager.write('planning', globalConfig);
    const cf = new ConfigFile(aiDir, logger, 'planning', globalManager);

    const config = await cf.read();
    expect(config.workers.global).toBeDefined();
  });

  it('falls back to builtin when both local and global missing', async () => {
    const cf = new ConfigFile(aiDir, logger, 'planning', globalManager);
    const config = await cf.read();
    const builtin = getBuiltinConfig('planning')!;
    expect(config.workers.planner).toBeDefined();
    expect(config.workflow).toEqual(builtin.workflow);
  });

  it('falls back to default when no configName and file missing', async () => {
    const cf = new ConfigFile(aiDir, logger, undefined, globalManager);
    const config = await cf.read();
    const defaultConfig = getDefaultConfig();
    expect(config).toEqual(defaultConfig);
  });

  it('works without GlobalConfigManager (backwards compat)', async () => {
    const cf = new ConfigFile(aiDir, logger, 'planning');
    // No global manager, no local file — should fall back to builtin
    const config = await cf.read();
    expect(config.workers.planner).toBeDefined();
  });
});
