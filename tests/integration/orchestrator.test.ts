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

  // Write plan file
  await fs.writeFile(path.join(testRepo.path, 'PLAN.md'), planContent, 'utf-8');

  // Initialize git repo for commit testing
  const { execa } = await import('execa');
  await execa('git', ['init'], { cwd: testRepo.path, reject: false });
  await execa('git', ['config', 'user.email', 'test@test.com'], { cwd: testRepo.path, reject: false });
  await execa('git', ['config', 'user.name', 'Test'], { cwd: testRepo.path, reject: false });

  // Initialize state
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
        if (coderCalls === 1) {
          return { task_id: '1', status: 'completed' };
        }
        return { task_id: '2', status: 'completed' };
      },
    });

    let reviewerCalls = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        reviewerCalls++;
        // First review approves task 1, second approves task 2 and signals done
        if (reviewerCalls === 1) {
          return { approved: true, done: false, issues: [], confidence: 0.95 };
        }
        return { approved: true, done: true, issues: [], confidence: 0.95 };
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
      output: { approved: true, done: false, issues: [], confidence: 0.95 },
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

    // First call rejects, second approves
    let callCount = 0;
    const reviewerWorker = new MockWorker('reviewer', {
      outputFn: () => {
        callCount++;
        if (callCount === 1) {
          return {
            approved: false,
            done: false,
            issues: [{ description: 'Missing edge case', severity: 'high' }],
            confidence: 0.7,
          };
        }
        return { approved: true, done: false, issues: [], confidence: 0.9 };
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

    // Flow: coder -> reviewer rejects -> coder (fix) -> reviewer approves -> done (manual)
    expect(result.success).toBe(true);
    expect(result.finalStatus.completed_tasks).toEqual(['1']);
    expect(result.finalStatus.iteration).toBe(0); // Reset after approval
  });

  it('stops at max iterations per task', async () => {
    const context = await setupTestRepo(testRepo);
    const config = { ...getDefaultConfig(), max_iterations_per_task: 2 };
    await context.configFile.write(config);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    // Never approves
    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: false,
        done: false,
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
      output: { approved: true, done: false, issues: [], confidence: 0.9 },
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

  it('stops on human required (critical issue)', async () => {
    const context = await setupTestRepo(testRepo);

    const coderWorker = new MockWorker('coder', {
      output: { task_id: '1', status: 'completed' },
    });

    const reviewerWorker = new MockWorker('reviewer', {
      output: {
        approved: false,
        done: false,
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
});
