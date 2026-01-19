import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAnvilContext, createOrchestrator } from '../../src/core/factory.js';
import { getDefaultConfig } from '../../src/types/config.js';
import { MockDeveloperAgent } from '../../src/agents/mock/developer.js';
import { MockReviewerAgent } from '../../src/agents/mock/reviewer.js';
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

describe('Orchestrator Integration', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => {
    testRepo = await createTestRepo();
  });

  afterEach(async () => {
    await testRepo.cleanup();
  });

  it('completes a full loop with mock agents', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    // Initialize
    await context.aiDir.create();
    await context.configFile.write(config);
    await context.specFile.write('# Test Feature\n\nImplement something');
    await context.statusFile.initialize('test-feature');

    // Create orchestrator
    const orchestrator = createOrchestrator(context, config);

    // Run
    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(result.finalStatus.status).toBe('done');
    expect(result.finalStatus.done).toBe(true);
    expect(result.totalIterations).toBe(2); // Mock approves after 2 iterations
  });

  it('stops at max iterations', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = { ...getDefaultConfig(), max_iterations: 2 };

    // Initialize
    await context.aiDir.create();
    await context.configFile.write(config);
    await context.specFile.write('# Test Feature');
    await context.statusFile.initialize('test-feature');

    // Create orchestrator with mock that never approves
    const logger = createLogger({ level: 'silent' });
    const deps: OrchestratorDependencies = {
      logger,
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      specFile: context.specFile,
      reviewOutputFile: context.reviewOutputFile,
      developerAgent: new MockDeveloperAgent(),
      reviewerAgent: new MockReviewerAgent({ approveAfterIterations: 10 }), // Never approves
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.reason).toContain('Maximum iterations');
  });

  it('stops on human required', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    // Initialize
    await context.aiDir.create();
    await context.configFile.write(config);
    await context.specFile.write('# Test Feature');
    await context.statusFile.initialize('test-feature');

    // Create orchestrator with mock that requests human
    const logger = createLogger({ level: 'silent' });
    const deps: OrchestratorDependencies = {
      logger,
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      specFile: context.specFile,
      reviewOutputFile: context.reviewOutputFile,
      developerAgent: new MockDeveloperAgent(),
      reviewerAgent: new MockReviewerAgent({ requestHuman: true }),
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.finalStatus.human_required).toBe(true);
  });

  it('stops on low confidence', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    // Initialize
    await context.aiDir.create();
    await context.configFile.write(config);
    await context.specFile.write('# Test Feature');
    await context.statusFile.initialize('test-feature');

    // Create orchestrator with mock that has low confidence
    const logger = createLogger({ level: 'silent' });
    const deps: OrchestratorDependencies = {
      logger,
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      specFile: context.specFile,
      reviewOutputFile: context.reviewOutputFile,
      developerAgent: new MockDeveloperAgent(),
      reviewerAgent: new MockReviewerAgent({ confidence: 0.3 }), // Below threshold
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.finalStatus.human_required).toBe(true);
  });

  it('handles developer failure', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    // Initialize
    await context.aiDir.create();
    await context.configFile.write(config);
    await context.specFile.write('# Test Feature');
    await context.statusFile.initialize('test-feature');

    // Create orchestrator with failing developer
    const logger = createLogger({ level: 'silent' });
    const deps: OrchestratorDependencies = {
      logger,
      stateMachine: new StateMachine(),
      statusFile: context.statusFile,
      configFile: context.configFile,
      specFile: context.specFile,
      reviewOutputFile: context.reviewOutputFile,
      developerAgent: new MockDeveloperAgent({ shouldFail: true }),
      reviewerAgent: new MockReviewerAgent(),
    };

    const orchestrator = new Orchestrator(testRepo.path, deps);
    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.finalStatus.status).toBe('blocked');
  });
});
