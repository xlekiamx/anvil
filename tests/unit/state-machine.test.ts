import { describe, it, expect, beforeEach } from 'vitest';
import { StateMachine } from '../../src/core/state-machine.js';
import { createInitialStatus } from '../../src/types/status.js';
import { getDefaultConfig } from '../../src/types/config.js';
import type { ReviewOutput } from '../../src/types/review.js';

describe('StateMachine', () => {
  let stateMachine: StateMachine;

  beforeEach(() => {
    stateMachine = new StateMachine();
  });

  describe('canTransition', () => {
    it('allows needs_fix -> needs_review', () => {
      expect(stateMachine.canTransition('needs_fix', 'needs_review')).toBe(true);
    });

    it('allows needs_review -> needs_fix', () => {
      expect(stateMachine.canTransition('needs_review', 'needs_fix')).toBe(true);
    });

    it('allows needs_review -> done', () => {
      expect(stateMachine.canTransition('needs_review', 'done')).toBe(true);
    });

    it('allows needs_fix -> blocked', () => {
      expect(stateMachine.canTransition('needs_fix', 'blocked')).toBe(true);
    });

    it('allows needs_review -> blocked', () => {
      expect(stateMachine.canTransition('needs_review', 'blocked')).toBe(true);
    });

    it('allows blocked -> needs_fix (resume)', () => {
      expect(stateMachine.canTransition('blocked', 'needs_fix')).toBe(true);
    });

    it('disallows needs_fix -> done', () => {
      expect(stateMachine.canTransition('needs_fix', 'done')).toBe(false);
    });

    it('disallows done -> needs_fix', () => {
      expect(stateMachine.canTransition('done', 'needs_fix')).toBe(false);
    });
  });

  describe('transition', () => {
    it('transitions from needs_fix to needs_review', () => {
      const status = createInitialStatus('test-feature');
      const newStatus = stateMachine.transition(status, 'needs_review', 'developer_complete');

      expect(newStatus.status).toBe('needs_review');
      expect(newStatus.feature_id).toBe('test-feature');
    });

    it('sets done=true when transitioning to done', () => {
      const status = { ...createInitialStatus('test-feature'), status: 'needs_review' as const };
      const newStatus = stateMachine.transition(status, 'done', 'approved');

      expect(newStatus.status).toBe('done');
      expect(newStatus.done).toBe(true);
    });

    it('throws on invalid transition', () => {
      const status = createInitialStatus('test-feature');

      expect(() => stateMachine.transition(status, 'done', 'approved')).toThrow();
    });
  });

  describe('getValidNextStates', () => {
    it('returns valid next states for needs_fix', () => {
      const nextStates = stateMachine.getValidNextStates('needs_fix');

      expect(nextStates).toContain('needs_review');
      expect(nextStates).toContain('blocked');
      expect(nextStates).not.toContain('done');
    });

    it('returns valid next states for needs_review', () => {
      const nextStates = stateMachine.getValidNextStates('needs_review');

      expect(nextStates).toContain('needs_fix');
      expect(nextStates).toContain('done');
      expect(nextStates).toContain('blocked');
    });

    it('returns empty array for done', () => {
      const nextStates = stateMachine.getValidNextStates('done');

      expect(nextStates).toHaveLength(0);
    });
  });

  describe('shouldStop', () => {
    it('returns stop=true when status is done', () => {
      const status = { ...createInitialStatus('test'), status: 'done' as const, done: true };
      const config = getDefaultConfig();

      const result = stateMachine.shouldStop(status, config);

      expect(result.stop).toBe(true);
      expect(result.reason).toBe('Feature approved');
    });

    it('returns stop=true when status is blocked', () => {
      const status = { ...createInitialStatus('test'), status: 'blocked' as const, blocked_reason: 'test' };
      const config = getDefaultConfig();

      const result = stateMachine.shouldStop(status, config);

      expect(result.stop).toBe(true);
    });

    it('returns stop=true when max iterations reached', () => {
      const status = { ...createInitialStatus('test'), iteration: 6 };
      const config = { ...getDefaultConfig(), max_iterations: 6 };

      const result = stateMachine.shouldStop(status, config);

      expect(result.stop).toBe(true);
      expect(result.reason).toContain('Maximum iterations');
    });

    it('returns stop=true when human_required is true', () => {
      const status = { ...createInitialStatus('test'), human_required: true };
      const config = getDefaultConfig();

      const result = stateMachine.shouldStop(status, config);

      expect(result.stop).toBe(true);
      expect(result.reason).toBe('Human intervention required');
    });

    it('returns stop=false for active session', () => {
      const status = createInitialStatus('test');
      const config = getDefaultConfig();

      const result = stateMachine.shouldStop(status, config);

      expect(result.stop).toBe(false);
    });
  });

  describe('shouldRequestHumanIntervention', () => {
    it('returns required=true when reviewer requests human', () => {
      const config = getDefaultConfig();
      const review: ReviewOutput = {
        approved: false,
        issues: [],
        summary: 'Test',
        confidence: 0.9,
        request_human: true,
      };

      const result = stateMachine.shouldRequestHumanIntervention(review, config);

      expect(result.required).toBe(true);
      expect(result.reason).toContain('Reviewer requested');
    });

    it('returns required=true when confidence is low', () => {
      const config = { ...getDefaultConfig(), human_required_on: { ...getDefaultConfig().human_required_on, low_confidence_threshold: 0.7 } };
      const review: ReviewOutput = {
        approved: false,
        issues: [],
        summary: 'Test',
        confidence: 0.5,
        request_human: false,
      };

      const result = stateMachine.shouldRequestHumanIntervention(review, config);

      expect(result.required).toBe(true);
      expect(result.reason).toContain('Confidence');
    });

    it('returns required=true for security issues', () => {
      const config = getDefaultConfig();
      const review: ReviewOutput = {
        approved: false,
        issues: [
          { id: 'R1', severity: 'critical', category: 'security', description: 'SQL injection' },
        ],
        summary: 'Security issue found',
        confidence: 0.9,
        request_human: false,
      };

      const result = stateMachine.shouldRequestHumanIntervention(review, config);

      expect(result.required).toBe(true);
      expect(result.reason).toContain('Security');
    });

    it('returns required=false for normal review', () => {
      const config = getDefaultConfig();
      const review: ReviewOutput = {
        approved: false,
        issues: [
          { id: 'R1', severity: 'medium', category: 'correctness', description: 'Bug' },
        ],
        summary: 'Bug found',
        confidence: 0.9,
        request_human: false,
      };

      const result = stateMachine.shouldRequestHumanIntervention(review, config);

      expect(result.required).toBe(false);
    });
  });

  describe('determineNextAction', () => {
    it('returns invoke_developer for needs_fix', () => {
      const status = createInitialStatus('test');

      expect(stateMachine.determineNextAction(status)).toBe('invoke_developer');
    });

    it('returns invoke_reviewer for needs_review', () => {
      const status = { ...createInitialStatus('test'), status: 'needs_review' as const };

      expect(stateMachine.determineNextAction(status)).toBe('invoke_reviewer');
    });

    it('returns stop for done', () => {
      const status = { ...createInitialStatus('test'), status: 'done' as const };

      expect(stateMachine.determineNextAction(status)).toBe('stop');
    });

    it('returns stop for blocked', () => {
      const status = { ...createInitialStatus('test'), status: 'blocked' as const };

      expect(stateMachine.determineNextAction(status)).toBe('stop');
    });
  });
});
