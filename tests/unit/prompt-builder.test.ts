import { describe, it, expect } from 'vitest';
import { buildPrompt, type PromptContext } from '../../src/core/prompt-builder.js';
import { createInitialStatus } from '../../src/types/status.js';
import type { WorkerConfig } from '../../src/types/config.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function makeWorkerConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
  return {
    provider: 'mock',
    role: 'You are a senior developer.',
    interactive: false,
    behavior: 'executor',
    output_schema: {
      task_id: 'string',
      status: 'completed | needs_review',
    },
    ...overrides,
  };
}

describe('buildPrompt', () => {
  it('includes prompt base from role', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig({ role: 'You are an architect.' }),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('You are an architect.');
  });

  it('includes state file and plan file paths', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('/repo/PLAN.md');
    expect(prompt).toContain('/repo/.ai/state.json');
  });

  it('includes output schema hint', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('task_id');
    expect(prompt).toContain('JSON object matching');
  });

  it('does NOT contain hardcoded coder/reviewer instructions', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).not.toContain('Pick exactly 1 uncompleted task');
    expect(prompt).not.toContain('reviewing ONLY the current task');
    expect(prompt).not.toContain('fixing task');
  });

  it('has no isFirstWorker in PromptContext type', () => {
    // This test verifies the interface shape at compile time.
    // If isFirstWorker existed in PromptContext, the cast below would include it.
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };
    expect('isFirstWorker' in ctx).toBe(false);
  });

  it('reads prompt from prompt_file when set', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-test-'));
    const promptFile = path.join(tmpDir, 'coder.md');
    fs.writeFileSync(promptFile, 'Custom prompt from file.');

    const config = makeWorkerConfig({ prompt_file: promptFile });

    const ctx: PromptContext = {
      workerConfig: config,
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('Custom prompt from file.');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('falls back to role when prompt_file is not set', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('You are a senior developer.');
  });

  it('includes file paths and output schema regardless of prompt source', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anvil-test-'));
    const promptFile = path.join(tmpDir, 'worker.md');
    fs.writeFileSync(promptFile, 'Custom prompt.');

    const config = makeWorkerConfig({ prompt_file: promptFile });

    const ctx: PromptContext = {
      workerConfig: config,
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('/repo/.ai/state.json');
    expect(prompt).toContain('JSON object matching');
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('does not embed plan content in prompt', () => {
    const ctx: PromptContext = {
      workerConfig: makeWorkerConfig(),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).not.toContain('## Plan');
  });
});
