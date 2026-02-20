import { describe, it, expect } from 'vitest';
import { buildPrompt, type PromptContext } from '../../src/core/prompt-builder.js';
import { createInitialStatus } from '../../src/types/status.js';
import type { WorkerConfig } from '../../src/types/config.js';

function makeCoderConfig(): WorkerConfig {
  return {
    provider: 'mock',
    role: 'You are a senior developer.',
    interactive: false,
    output_schema: {
      task_id: 'string',
      status: 'completed | needs_review',
    },
  };
}

function makeReviewerConfig(): WorkerConfig {
  return {
    provider: 'mock',
    role: 'You are a code reviewer.',
    interactive: false,
    output_schema: {
      approved: 'boolean',
      issues: [],
      confidence: 'number',
    },
  };
}

describe('buildPrompt', () => {
  it('includes the worker role', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('You are a senior developer.');
  });

  it('tells coder to read plan and state files', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('/repo/PLAN.md');
    expect(prompt).toContain('/repo/.ai/state.json');
  });

  it('includes output schema hint', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('task_id');
    expect(prompt).toContain('JSON object matching');
  });

  it('tells coder to pick 1 uncompleted task when no current task', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('Pick exactly 1 uncompleted task');
    expect(prompt).toContain('completed_tasks');
  });

  it('tells coder to fix when current task is fixing', () => {
    const state = createInitialStatus('./PLAN.md', 'coder');
    state.current_task = { id: '5', status: 'fixing' };

    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state,
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('fixing task 5');
    expect(prompt).toContain('review issues');
  });

  it('tells reviewer to get current task from state and details from plan', () => {
    const state = createInitialStatus('./PLAN.md', 'reviewer');
    state.current_task = { id: '3', status: 'in_review' };

    const ctx: PromptContext = {
      workerConfig: makeReviewerConfig(),
      state,
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: false,
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('/repo/.ai/state.json');
    expect(prompt).toContain('/repo/PLAN.md');
    expect(prompt).toContain('current task');
    expect(prompt).toContain('reviewing ONLY the current task');
  });

  it('does not embed plan content in prompt', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planFile: '/repo/PLAN.md',
      stateFile: '/repo/.ai/state.json',
      isFirstWorker: true,
    };

    const prompt = buildPrompt(ctx);
    // Should reference the file path, not contain plan content
    expect(prompt).not.toContain('## Plan');
  });
});
