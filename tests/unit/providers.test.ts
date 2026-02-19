import { describe, it, expect } from 'vitest';
import { MockWorker } from '../../src/agents/providers/mock.js';
import { createWorker, createWorkers } from '../../src/agents/factory.js';
import type { WorkerConfig } from '../../src/types/config.js';

describe('MockWorker', () => {
  it('returns configured JSON output', async () => {
    const worker = new MockWorker('test-coder', {
      output: { task_id: '1', task_description: 'Setup', status: 'completed' },
    });

    const result = await worker.execute('test prompt', '/tmp');

    expect(result.success).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.task_id).toBe('1');
    expect(parsed.task_description).toBe('Setup');
  });

  it('returns failure when shouldFail is true', async () => {
    const worker = new MockWorker('test-worker', { shouldFail: true });

    const result = await worker.execute('prompt', '/tmp');

    expect(result.success).toBe(false);
    expect(result.error).toContain('failure');
  });

  it('uses outputFn when provided', async () => {
    const worker = new MockWorker('test-worker', {
      outputFn: (prompt) => ({ echo: prompt.slice(0, 5) }),
    });

    const result = await worker.execute('hello world', '/tmp');

    expect(result.success).toBe(true);
    expect(JSON.parse(result.output)).toEqual({ echo: 'hello' });
  });

  it('has correct name', () => {
    const worker = new MockWorker('my-worker');
    expect(worker.name).toBe('my-worker');
  });

  it('reports duration', async () => {
    const worker = new MockWorker('test', { delayMs: 50 });

    const result = await worker.execute('prompt', '/tmp');

    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });
});

describe('createWorker', () => {
  it('creates mock worker', () => {
    const config: WorkerConfig = {
      provider: 'mock',
      role: 'Test role',
      interactive: false,
      output_schema: {},
    };

    const worker = createWorker('test', config);
    expect(worker.name).toBe('test');
  });

  it('creates claude worker', () => {
    const config: WorkerConfig = {
      provider: 'claude',
      role: 'Developer role',
      interactive: true,
      output_schema: {},
    };

    const worker = createWorker('coder', config);
    expect(worker.name).toBe('coder');
  });

  it('creates codex worker', () => {
    const config: WorkerConfig = {
      provider: 'codex',
      role: 'Reviewer role',
      interactive: false,
      output_schema: {},
    };

    const worker = createWorker('reviewer', config);
    expect(worker.name).toBe('reviewer');
  });

  it('throws on unknown provider', () => {
    const config = {
      provider: 'unknown' as 'mock',
      role: 'Test',
      interactive: false,
      output_schema: {},
    };

    expect(() => createWorker('test', config)).toThrow('Unknown provider');
  });
});

describe('createWorkers', () => {
  it('creates a map of workers from config', () => {
    const workersConfig = {
      coder: {
        provider: 'mock' as const,
        role: 'Developer',
        interactive: false,
        output_schema: {},
      },
      reviewer: {
        provider: 'mock' as const,
        role: 'Reviewer',
        interactive: false,
        output_schema: {},
      },
    };

    const workers = createWorkers(workersConfig);

    expect(workers.size).toBe(2);
    expect(workers.get('coder')?.name).toBe('coder');
    expect(workers.get('reviewer')?.name).toBe('reviewer');
  });
});
