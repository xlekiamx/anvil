import type { Worker, WorkerResult } from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface MockWorkerOptions {
  delayMs?: number;
  shouldFail?: boolean;
  /** Static JSON output to return */
  output?: Record<string, unknown>;
  /** Function to dynamically generate output based on prompt */
  outputFn?: (prompt: string) => Record<string, unknown>;
}

export class MockWorker implements Worker {
  readonly name: string;

  constructor(
    name: string,
    private readonly options: MockWorkerOptions = {}
  ) {
    this.name = name;
  }

  kill(): void {
    // No-op for mock
  }

  async execute(prompt: string, _cwd: string): Promise<WorkerResult> {
    const start = Date.now();

    await sleep(this.options.delayMs ?? 10);

    if (this.options.shouldFail) {
      return {
        success: false,
        output: '',
        error: `Mock worker '${this.name}' failure`,
        durationMs: Date.now() - start,
      };
    }

    let output: Record<string, unknown>;
    if (this.options.outputFn) {
      output = this.options.outputFn(prompt);
    } else if (this.options.output) {
      output = this.options.output;
    } else {
      output = {};
    }

    return {
      success: true,
      output: JSON.stringify(output),
      durationMs: Date.now() - start,
    };
  }
}
