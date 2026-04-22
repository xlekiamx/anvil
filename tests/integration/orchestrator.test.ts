import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAnvilContext } from '../../src/core/factory.js';
import { getDefaultConfig } from '../../src/types/config.js';
import { MockWorker } from '../../src/agents/providers/mock.js';
import { StateMachine } from '../../src/core/state-machine.js';
import { Orchestrator, type OrchestratorDependencies } from '../../src/core/orchestrator.js';
import { createLogger } from '../../src/logger/index.js';

async function createTestRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-test-'));
  return {
    path: dir,
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

async function setupTestRepo(
  testRepo: { path: string },
  planContent = '# Plan\n\n- [ ] Task 1: Setup project\n- [ ] Task 2: Add auth'
): Promise<ReturnType<typeof createAnvilContext>> {
  const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
  const config = getDefaultConfig();

  await context.aiDir.create();
  await context.configFile.write(config);

  await fs.writeFile(path.join(testRepo.path, 'PLAN.md'), planContent, 'utf-8');

  const { execa } = await import('execa');
  await execa('git', ['init'], { cwd: testRepo.path, reject: false });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: testRepo.path, reject: false });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: testRepo.path, reject: false });

  await context.statusFile.initialize(config.plan_file, config.workflow[0]!);

  return context;
}

describe('Orchestrator Integration', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('completes a full coder->reviewer->approve loop in auto mode', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), max_iterations_per_task: 4 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        if (coderCalls === 1) return { task_id: '1', status: 'completed' };
        return { task_id: '2', status: 'completed' };
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) {
          return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 };
        }
        return { approved: true, done: true, completed_tasks: ['1', '2'], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.reason).toBe('All plan tasks completed');
    expect(result.finalStatus.done).toBe(true);
    expect(result.finalStatus.completed_tasks).toEqual(['1', '2']);
    expect(coderCalls).toBe(2);
    expect(reviewerCalls).toBe(2);
  });

  it('completes a task in manual loop mode', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.reason).toContain('manual');
    expect(result.finalStatus.completed_tasks).toEqual(['1']);
    expect(result.finalStatus.current_task).toBeNull();
    expect(result.finalStatus.turn).toBe('coder');
  });

  it('handles reviewer rejection and fix cycle', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    let callCount = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        callCount++;
        if (callCount === 1) {
          return {
            approved: false, done: false, completed_tasks: [],
            issues: [{ description: 'Missing edge case', severity: 'high' }],
            confidence: 0.7,
          };
        }
        return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.9 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.completed_tasks).toEqual(['1']);
    expect(result.finalStatus.iteration).toBe(0);
  });

  it('stops at max iterations per task', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), max_iterations_per_task: 2 };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: false, done: false, completed_tasks: [],
        issues: [{ description: 'Still wrong', severity: 'medium' }],
        confidence: 0.5,
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Maximum iterations');
  });

  it('stops on worker failure', async () => {
    const context = await setupTestRepo(testRepo);

    const coderWorker = new MockWorker('coder', { shouldFail: true });
    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: [], issues: [], confidence: 0.9 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.finalStatus.blocked_reason).toContain('failure');
  });

  it('does not stop on critical issue when human_intervention is false', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, human_intervention: false };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) {
          return {
            approved: false, done: false, completed_tasks: [],
            issues: [{ description: 'SQL injection vulnerability', severity: 'critical' }],
            confidence: 0.9,
          };
        }
        return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.9 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.finalStatus.human_required).toBe(false);
    expect(result.success).toBe(true);
    expect(reviewerCalls).toBe(2); // critical issue treated as rejection, coder fixes, reviewer approves
  });

  it('stops on human required (critical issue)', async () => {
    const context = await setupTestRepo(testRepo);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: false, done: false, completed_tasks: [],
        issues: [{ description: 'SQL injection vulnerability', severity: 'critical' }],
        confidence: 0.9,
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.finalStatus.human_required).toBe(true);
  });

  it('handles coder implementing multiple tasks in one go', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    // Coder reports task_id: '1' but actually implements tasks 1, 2, and 3
    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    // Reviewer detects all three are done
    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: true, done: false,
        completed_tasks: ['1', '2', '3'],
        issues: [], confidence: 0.95,
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.completed_tasks).toEqual(['1', '2', '3']);
  });

  it('persists executor progress in batch mode and advances to reviewer when executor signals done', async () => {
    const context = await setupTestRepo(testRepo);
    const config = {
      ...getDefaultConfig(),
      loop_mode: 'manual' as const,
      review_strategy: 'batch' as const,
    };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        if (coderCalls === 1) return { task_id: '1', status: 'completed' };
        if (coderCalls === 2) return { task_id: '2', status: 'completed' };
        return { task_id: '', status: 'completed' };
      },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: true,
        done: false,
        completed_tasks: ['1', '2'],
        issues: [],
        confidence: 0.95,
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.completed_tasks).toEqual(['1', '2']);
    expect(result.finalStatus.turn).toBe('coder');
    expect(coderCalls).toBe(3);
  });

  it('appends executor notes to state', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      outputFn: () => ({ task_id: '1', status: 'completed', notes: ['Used pattern X for testability'] }),
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.notes).toContain('Used pattern X for testability');
  });

  it('accumulates notes across executor iterations', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), max_iterations_per_task: 4 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        if (coderCalls === 1) return { task_id: '1', status: 'completed', notes: ['Note from first run'] };
        return { task_id: '2', status: 'completed', notes: ['Note from second run'] };
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 };
        return { approved: true, done: true, completed_tasks: ['1', '2'], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.notes).toContain('Note from first run');
    expect(result.finalStatus.notes).toContain('Note from second run');
  });

  it('executor output without notes leaves state notes unchanged', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.notes).toEqual([]);
  });

  it('retries same worker when output is invalid JSON', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, parse_error_retries: 2 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      rawOutputFn: () => {
        coderCalls++;
        if (coderCalls < 2) return 'This is not valid JSON at all';
        return JSON.stringify({ task_id: '1', status: 'completed' });
      },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(coderCalls).toBe(2); // retried once, then succeeded
    expect(result.finalStatus.parse_error_count).toBe(0); // reset after success
  });

  it('does not retry executor JSON parsing while fixing; advances to reviewer', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, parse_error_retries: 2 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      rawOutputFn: () => {
        coderCalls++;
        if (coderCalls === 1) {
          return JSON.stringify({ task_id: '1', status: 'completed' });
        }
        return 'Fixed it locally and added tests.';
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) {
          return {
            approved: false,
            done: false,
            completed_tasks: [],
            issues: [{ description: 'Handle null input edge case', severity: 'medium' }],
            confidence: 0.8,
          };
        }
        return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(coderCalls).toBe(2); // initial implementation + one fix attempt (no parse retries while fixing)
    expect(reviewerCalls).toBe(2); // initial rejection + post-fix review
    expect(result.finalStatus.completed_tasks).toEqual(['1']);
  });

  it('advances to next turn after parse_error_retries exhausted', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, parse_error_retries: 2 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      rawOutputFn: () => {
        coderCalls++;
        return 'not json at all ever';
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        return { approved: true, done: false, completed_tasks: [], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    // After parse_error_retries exhausted (3 bad calls total), advances to reviewer
    expect(coderCalls).toBe(3); // initial + 2 retries
    expect(reviewerCalls).toBe(1); // reviewer got called
    expect(result.finalStatus.parse_error_count).toBe(0); // reset after advancing
  });

  it('resets parse_error_count after successful parse', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, parse_error_retries: 3 };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      rawOutputFn: () => {
        coderCalls++;
        if (coderCalls < 3) return 'invalid json';
        return JSON.stringify({ task_id: '1', status: 'completed' });
      },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.parse_error_count).toBe(0);
  });

  it('batch mode: executor runs multiple tasks before reviewer is called', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, review_strategy: 'batch' as const };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        if (coderCalls === 1) return { task_id: '1', status: 'completed' };
        if (coderCalls === 2) return { task_id: '2', status: 'completed' };
        return { task_id: '', status: 'completed' }; // no more tasks
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        return { approved: true, done: false, completed_tasks: ['1', '2'], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(coderCalls).toBe(3); // ran for task 1, task 2, then empty = done
    expect(reviewerCalls).toBe(1); // reviewer called once for all tasks
  });

  it('batch mode: reviewer rejection sends all feedback back to executor', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, review_strategy: 'batch' as const };
    await context.configFile.write(config);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        // After rejection, executor does one task then signals done
        if (coderCalls === 1) return { task_id: '1', status: 'completed' };
        if (coderCalls === 2) return { task_id: '', status: 'completed' }; // batch 1 done
        if (coderCalls === 3) return { task_id: '1', status: 'completed' }; // fix
        return { task_id: '', status: 'completed' }; // batch 2 done
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) {
          return { approved: false, done: false, completed_tasks: [], issues: [{ description: 'Missing tests', severity: 'high' }], confidence: 0.6 };
        }
        return { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(reviewerCalls).toBe(2);
    expect(coderCalls).toBe(4);
  });

  it('per-task mode unchanged with new config fields present', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, review_strategy: 'per_task' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.reason).toContain('manual');
    expect(result.finalStatus.completed_tasks).toEqual(['1']);
  });

  it('uses reviewer completed_tasks as source of truth for out-of-order tasks', async () => {
    const context = await setupTestRepo(testRepo);

    let coderCalls = 0;
    const coderWorker = new MockWorker('coder', {
      outputFn: () => {
        coderCalls++;
        // Coder picks task 3 first, then task 1
        if (coderCalls === 1) return { task_id: '3', status: 'completed' };
        return { task_id: '1', status: 'completed' };
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        if (reviewerCalls === 1) {
          return { approved: true, done: false, completed_tasks: ['3'], issues: [], confidence: 0.9 };
        }
        return { approved: true, done: true, completed_tasks: ['1', '2', '3'], issues: [], confidence: 0.9 };
      },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.done).toBe(true);
    // All tasks tracked even though coder only reported 3 and 1
    expect(result.finalStatus.completed_tasks).toContain('1');
    expect(result.finalStatus.completed_tasks).toContain('2');
    expect(result.finalStatus.completed_tasks).toContain('3');
  });

  it('calls committer worker after reviewer approves', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });
    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    let committerCalled = false;
    const committerWorker = new MockWorker('committer', {
      outputFn: () => { committerCalled = true; return {}; },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
      workerFactory: () => committerWorker,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    await orchestrator.run();

    expect(committerCalled).toBe(true);
  });

  it('skips committer worker when auto_commit is false', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, auto_commit: false };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });
    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    let committerCalled = false;
    const committerWorker = new MockWorker('committer', {
      outputFn: () => { committerCalled = true; return {}; },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
      workerFactory: () => committerWorker,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    await orchestrator.run();

    expect(committerCalled).toBe(false);
  });

  it('skips git commit when auto_commit is false', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), loop_mode: 'manual' as const, auto_commit: false };
    await context.configFile.write(config);

    const { execa } = await import('execa');
    // Make an initial commit so git log works
    await execa('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: testRepo.path, reject: false });

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });
    const reviewerWorker = new MockWorker('reviewer', {
      output: { approved: true, done: false, completed_tasks: ['1'], issues: [], confidence: 0.95 },
    });

    const workers = new Map();
    workers.set('coder', coderWorker);
    workers.set('reviewer', reviewerWorker);

    const deps: OrchestratorDependencies = {
      logger: createLogger({ level: 'silent' }),
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      workers,
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(true);

    // No anvil commit should have been made
    const log = await execa('git', ['log', '--oneline'], { cwd: testRepo.path, reject: false });
    expect(log.stdout).not.toContain('anvil:');
  });
});
