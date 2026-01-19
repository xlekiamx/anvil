import type {
  DeveloperAgent,
  DeveloperAgentResult,
  AgentContext,
} from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockDeveloperOptions {
  delayMs?: number;
  shouldFail?: boolean;
  failOnIteration?: number;
}

export class MockDeveloperAgent implements DeveloperAgent {
  readonly name = 'mock-developer';

  constructor(private readonly options: MockDeveloperOptions = {}) {}

  async execute(context: AgentContext): Promise<DeveloperAgentResult> {
    const start = Date.now();

    // Simulate work
    await sleep(this.options.delayMs ?? 100);

    // Simulate failure on specific iteration
    if (
      this.options.failOnIteration !== undefined &&
      context.status.iteration === this.options.failOnIteration
    ) {
      return {
        success: false,
        error: `Mock failure on iteration ${context.status.iteration}`,
        durationMs: Date.now() - start,
      };
    }

    // General failure mode
    if (this.options.shouldFail) {
      return {
        success: false,
        error: 'Mock developer failure',
        durationMs: Date.now() - start,
      };
    }

    return {
      success: true,
      durationMs: Date.now() - start,
      filesChanged: ['src/mock-change.ts'],
      annotations: `Mock developer completed iteration ${context.status.iteration}`,
    };
  }
}
