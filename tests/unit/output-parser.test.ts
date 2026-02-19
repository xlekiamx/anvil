import { describe, it, expect } from 'vitest';
import {
  parseOutput,
  validateCoderOutput,
  validateReviewerOutput,
} from '../../src/core/output-parser.js';

describe('parseOutput', () => {
  it('parses valid JSON', () => {
    const result = parseOutput('{"key": "value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses JSON from markdown code block', () => {
    const result = parseOutput('```json\n{"key": "value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  it('throws on empty output', () => {
    expect(() => parseOutput('')).toThrow('Empty output');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseOutput('not json at all')).toThrow('Invalid JSON');
  });

  it('handles whitespace around JSON', () => {
    const result = parseOutput('  \n{"key": "value"}\n  ');
    expect(result).toEqual({ key: 'value' });
  });
});

describe('validateCoderOutput', () => {
  it('validates correct coder output', () => {
    const result = validateCoderOutput({
      task_id: '5',
      status: 'completed',
    });

    expect(result.task_id).toBe('5');
    expect(result.status).toBe('completed');
  });

  it('throws on missing task_id', () => {
    expect(() => validateCoderOutput({
      status: 'completed',
    })).toThrow('task_id');
  });

  it('throws on missing status', () => {
    expect(() => validateCoderOutput({
      task_id: '1',
    })).toThrow('status');
  });
});

describe('validateReviewerOutput', () => {
  it('validates correct reviewer output', () => {
    const result = validateReviewerOutput({
      approved: false,
      issues: [
        { description: 'Bug found', severity: 'high' },
      ],
      confidence: 0.85,
    });

    expect(result.approved).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.description).toBe('Bug found');
    expect(result.confidence).toBe(0.85);
  });

  it('validates approved output with empty issues', () => {
    const result = validateReviewerOutput({
      approved: true,
      done: false,
      issues: [],
      confidence: 0.95,
    });

    expect(result.approved).toBe(true);
    expect(result.done).toBe(false);
    expect(result.issues).toHaveLength(0);
  });

  it('detects done signal from reviewer', () => {
    const result = validateReviewerOutput({
      approved: true,
      done: true,
      issues: [],
      confidence: 0.95,
    });

    expect(result.approved).toBe(true);
    expect(result.done).toBe(true);
  });

  it('defaults done to false if missing', () => {
    const result = validateReviewerOutput({
      approved: true,
      issues: [],
    });

    expect(result.done).toBe(false);
  });

  it('throws on missing approved field', () => {
    expect(() => validateReviewerOutput({
      issues: [],
      confidence: 0.9,
    })).toThrow('approved');
  });

  it('throws on missing issues field', () => {
    expect(() => validateReviewerOutput({
      approved: true,
      confidence: 0.9,
    })).toThrow('issues');
  });

  it('defaults confidence to 0.7 if missing', () => {
    const result = validateReviewerOutput({
      approved: true,
      issues: [],
    });

    expect(result.confidence).toBe(0.7);
  });

  it('handles issues with missing fields gracefully', () => {
    const result = validateReviewerOutput({
      approved: false,
      issues: [{ foo: 'bar' }],
      confidence: 0.5,
    });

    expect(result.issues[0]!.description).toBe('No description');
    expect(result.issues[0]!.severity).toBe('medium');
  });
});
