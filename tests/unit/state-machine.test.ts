import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/core/state-machine.js';
import { createInitialStatus } from '../../src/types/status.js';
import { getDefaultConfig } from '../../src/types/config.js';

describe('StateMachine', () => {
  let sm: StateMachine;
  const workflow = ['coder', 'reviewer'];

  beforeEach(() => {
    sm = new StateMachine();
  });

  describe('getNextWorker', () => {
    it('returns the current turn worker when active', () => {
      const state = createInitialStatus('./PLAN.md', 'coder');
      expect(sm.getNextWorker(state, workflow)).toBe('coder');
    });

    it('returns reviewer when turn is reviewer', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'reviewer'), turn: 'reviewer' };
      expect(sm.getNextWorker(state, workflow)).toBe('reviewer');
    });

    it('returns null when done', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), done: true };
      expect(sm.getNextWorker(state, workflow)).toBeNull();
    });

    it('returns null when human_required', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), human_required: true };
      expect(sm.getNextWorker(state, workflow)).toBeNull();
    });

    it('returns null when blocked', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), blocked_reason: 'Error' };
      expect(sm.getNextWorker(state, workflow)).toBeNull();
    });

    it('returns null when turn is not in workflow', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'unknown'), turn: 'unknown' };
      expect(sm.getNextWorker(state, workflow)).toBeNull();
    });
  });

  describe('getNextTurn', () => {
    it('advances coder to reviewer', () => {
      expect(sm.getNextTurn('coder', workflow)).toBe('reviewer');
    });

    it('wraps reviewer back to coder', () => {
      expect(sm.getNextTurn('reviewer', workflow)).toBe('coder');
    });

    it('wraps to first worker for unknown turn', () => {
      expect(sm.getNextTurn('unknown', workflow)).toBe('coder');
    });

    it('works with 3-worker workflows', () => {
      const w3 = ['planner', 'coder', 'reviewer'];
      expect(sm.getNextTurn('planner', w3)).toBe('coder');
      expect(sm.getNextTurn('coder', w3)).toBe('reviewer');
      expect(sm.getNextTurn('reviewer', w3)).toBe('planner');
    });
  });

  describe('shouldStop', () => {
    it('returns stop=true when done', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), done: true };
      const config = getDefaultConfig();
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('completed');
    });

    it('returns stop=true when blocked', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), blocked_reason: 'Error occurred' };
      const config = getDefaultConfig();
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(true);
      expect(result.reason).toBe('Error occurred');
    });

    it('returns stop=true when human_required', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), human_required: true };
      const config = getDefaultConfig();
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('Human');
    });

    it('returns stop=true when max iterations reached', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), iteration: 6 };
      const config = { ...getDefaultConfig(), max_iterations_per_task: 6 };
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(true);
      expect(result.reason).toContain('Maximum iterations');
    });

    it('returns stop=false for active session', () => {
      const state = createInitialStatus('./PLAN.md', 'coder');
      const config = getDefaultConfig();
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(false);
    });

    it('returns stop=false when iteration below max', () => {
      const state = { ...createInitialStatus('./PLAN.md', 'coder'), iteration: 3 };
      const config = { ...getDefaultConfig(), max_iterations_per_task: 6 };
      const result = sm.shouldStop(state, config);
      expect(result.stop).toBe(false);
    });
  });

  describe('shouldRequestHumanIntervention', () => {
    it('returns required=true for critical issues', () => {
      const result = sm.shouldRequestHumanIntervention({
        approved: false,
        issues: [{ description: 'SQL injection', severity: 'critical' }],
        confidence: 0.9,
      });
      expect(result.required).toBe(true);
      expect(result.reason).toContain('Critical');
    });

    it('returns required=true for very low confidence', () => {
      const result = sm.shouldRequestHumanIntervention({
        approved: false,
        issues: [],
        confidence: 0.2,
      });
      expect(result.required).toBe(true);
      expect(result.reason).toContain('confidence');
    });

    it('returns required=false for normal review', () => {
      const result = sm.shouldRequestHumanIntervention({
        approved: false,
        issues: [{ description: 'Minor bug', severity: 'medium' }],
        confidence: 0.8,
      });
      expect(result.required).toBe(false);
    });

    it('returns required=false for approved review', () => {
      const result = sm.shouldRequestHumanIntervention({
        approved: true,
        issues: [],
        confidence: 0.95,
      });
      expect(result.required).toBe(false);
    });

    it('returns required=false when output has no issues or confidence fields', () => {
      const result = sm.shouldRequestHumanIntervention({
        task_id: '1',
        status: 'completed',
      });
      expect(result.required).toBe(false);
    });

    it('works with any output shape', () => {
      const result = sm.shouldRequestHumanIntervention({
        custom_field: 'value',
        issues: [{ description: 'Critical bug', severity: 'critical' }],
      });
      expect(result.required).toBe(true);
    });
  });
});
