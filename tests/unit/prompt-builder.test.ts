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
      task_description: 'string',
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
      planContent: '# Plan\n- Task 1',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('You are a senior developer.');
  });

  it('includes plan content', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planContent: '# My Plan\n- Implement feature X',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('# My Plan');
    expect(prompt).toContain('Implement feature X');
  });

  it('includes output schema hint', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planContent: 'Plan content',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('task_id');
    expect(prompt).toContain('task_description');
    expect(prompt).toContain('JSON object matching');
  });

  it('includes completed tasks in state context', () => {
    const state = createInitialStatus('./PLAN.md', 'coder');
    state.completed_tasks = ['1', '2'];

    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state,
      planContent: 'Plan',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('[2]');
    expect(prompt).toContain('Already completed');
  });

  it('includes review issues when present', () => {
    const state = createInitialStatus('./PLAN.md', 'coder');
    state.review_issues = [
      { description: 'Missing edge case', severity: 'high' },
    ];

    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state,
      planContent: 'Plan',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('Missing edge case');
    expect(prompt).toContain('HIGH');
  });

  it('includes current task when present', () => {
    const state = createInitialStatus('./PLAN.md', 'coder');
    state.current_task = { id: '5', status: 'fixing' };

    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state,
      planContent: 'Plan',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('[5]');
    expect(prompt).toContain('fixing');
  });

  it('says to pick next task when no current task', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planContent: 'Plan',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('Pick the next incomplete task');
  });

  it('includes git diff when provided', () => {
    const ctx: PromptContext = {
      workerConfig: makeReviewerConfig(),
      state: createInitialStatus('./PLAN.md', 'reviewer'),
      planContent: 'Plan',
      gitDiff: 'diff --git a/file.ts b/file.ts\n+added line',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).toContain('Git Diff');
    expect(prompt).toContain('+added line');
  });

  it('does not include git diff section when not provided', () => {
    const ctx: PromptContext = {
      workerConfig: makeCoderConfig(),
      state: createInitialStatus('./PLAN.md', 'coder'),
      planContent: 'Plan',
    };

    const prompt = buildPrompt(ctx);
    expect(prompt).not.toContain('Git Diff');
  });
});
