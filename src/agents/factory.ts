import type { Worker } from './types.js';
import type { WorkerConfig } from '../types/config.js';
import { MockWorker } from './providers/mock.js';
import { ClaudeWorker } from './providers/claude.js';
import { CodexWorker } from './providers/codex.js';

export function createWorker(name: string, config: WorkerConfig): Worker {
  switch (config.provider) {
    case 'mock':
      return new MockWorker(name);
    case 'claude':
      return new ClaudeWorker(name, {
        model: config.model,
        interactive: config.interactive,
      });
    case 'codex':
      return new CodexWorker(name, {
        model: config.model,
        outputSchema: config.output_schema,
        sandbox: config.sandbox,
      });
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

export function createWorkers(workersConfig: Record<string, WorkerConfig>): Map<string, Worker> {
  const workers = new Map<string, Worker>();
  for (const [name, config] of Object.entries(workersConfig)) {
    workers.set(name, createWorker(name, config));
  }
  return workers;
}
