import { describe, it, expect } from 'vitest';
import {
  parseOutput,
  validateOutput,
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

describe('validateOutput', () => {
  it('validates output with string fields', () => {
    const result = validateOutput(
      { task_id: '1', status: 'completed' },
      { task_id: 'string', status: 'string' }
    );
    expect(result.task_id).toBe('1');
    expect(result.status).toBe('completed');
  });

  it('throws on missing required field', () => {
    expect(() =>
      validateOutput({}, { task_id: 'string' })
    ).toThrow('task_id');
  });

  it('validates output with boolean and array fields', () => {
    const result = validateOutput(
      { approved: true, issues: [] },
      { approved: 'boolean', issues: [] }
    );
    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('allows extra fields in output', () => {
    const result = validateOutput(
      { task_id: '1', status: 'done', extra: 'field' },
      { task_id: 'string', status: 'string' }
    );
    expect(result.extra).toBe('field');
  });

  it('defaults missing arrays to empty', () => {
    const result = validateOutput(
      { approved: true },
      { approved: 'boolean', issues: [] }
    );
    expect(result.issues).toEqual([]);
  });

  it('defaults missing booleans to false', () => {
    const result = validateOutput(
      { issues: [] },
      { approved: 'boolean', issues: [] }
    );
    expect(result.approved).toBe(false);
  });

  it('passes with full reviewer-like output', () => {
    const result = validateOutput(
      {
        approved: false,
        done: false,
        completed_tasks: ['1', '2'],
        issues: [{ description: 'Bug', severity: 'high' }],
        confidence: 0.85,
      },
      {
        approved: 'boolean',
        done: 'boolean',
        completed_tasks: ['string'],
        issues: [{ description: 'string', severity: 'string' }],
        confidence: 'number 0-1',
      }
    );
    expect(result.approved).toBe(false);
    expect(result.confidence).toBe(0.85);
  });

  it('validates with empty schema (no required fields)', () => {
    const result = validateOutput({ anything: 'goes' }, {});
    expect(result.anything).toBe('goes');
  });
});
