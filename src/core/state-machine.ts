import type { WorkflowStatus, Status, StateTransition } from '../types/status.js';
import type { Config } from '../types/config.js';
import type { ReviewOutput } from '../types/review.js';
import { StateTransitionError } from '../utils/errors.js';

export type TransitionTrigger =
  | 'developer_complete'
  | 'issues_found'
  | 'approved'
  | 'blocked'
  | 'human_required'
  | 'resume';

const VALID_TRANSITIONS: StateTransition[] = [
  { from: 'needs_fix', to: 'needs_review', trigger: 'developer_complete' },
  { from: 'needs_review', to: 'needs_fix', trigger: 'issues_found' },
  { from: 'needs_review', to: 'done', trigger: 'approved' },
  { from: 'needs_fix', to: 'blocked', trigger: 'blocked' },
  { from: 'needs_review', to: 'blocked', trigger: 'blocked' },
  { from: 'needs_fix', to: 'blocked', trigger: 'human_required' },
  { from: 'needs_review', to: 'blocked', trigger: 'human_required' },
  { from: 'blocked', to: 'needs_fix', trigger: 'resume' },
];

export class StateMachine {
  private readonly transitions: StateTransition[];

  constructor() {
    this.transitions = VALID_TRANSITIONS;
  }

  canTransition(from: WorkflowStatus, to: WorkflowStatus): boolean {
    return this.transitions.some((t) => t.from === from && t.to === to);
  }

  getValidNextStates(current: WorkflowStatus): WorkflowStatus[] {
    return [...new Set(
      this.transitions
        .filter((t) => t.from === current)
        .map((t) => t.to)
    )];
  }

  transition(
    status: Status,
    to: WorkflowStatus,
    _trigger: TransitionTrigger
  ): Status {
    if (!this.canTransition(status.status, to)) {
      throw new StateTransitionError(status.status, to);
    }

    const now = new Date().toISOString();
    const newStatus: Status = {
      ...status,
      status: to,
      updated_at: now,
    };

    if (to === 'done') {
      newStatus.done = true;
    }

    return newStatus;
  }

  shouldRequestHumanIntervention(
    reviewOutput: ReviewOutput,
    config: Config
  ): { required: boolean; reason?: string } {
    // Check explicit request from reviewer
    if (reviewOutput.request_human) {
      return { required: true, reason: 'Reviewer requested human intervention' };
    }

    // Check low confidence
    const threshold = config.human_required_on.low_confidence_threshold;
    if (reviewOutput.confidence < threshold) {
      return {
        required: true,
        reason: `Confidence ${reviewOutput.confidence.toFixed(2)} below threshold ${threshold}`,
      };
    }

    // Check security issues
    if (config.human_required_on.security_issues) {
      const securityIssue = reviewOutput.issues.find(
        (i) => i.category === 'security' || i.severity === 'critical'
      );
      if (securityIssue) {
        return {
          required: true,
          reason: `Security/critical issue found: ${securityIssue.description}`,
        };
      }
    }

    // Check specific categories
    const triggerCategories = config.human_required_on.categories;
    const matchingIssue = reviewOutput.issues.find((i) =>
      triggerCategories.includes(i.category)
    );
    if (matchingIssue) {
      return {
        required: true,
        reason: `Issue in monitored category '${matchingIssue.category}': ${matchingIssue.description}`,
      };
    }

    return { required: false };
  }

  shouldStop(
    status: Status,
    config: Config
  ): { stop: boolean; reason?: string } {
    // Already done
    if (status.done || status.status === 'done') {
      return { stop: true, reason: 'Feature approved' };
    }

    // Blocked
    if (status.status === 'blocked') {
      return { stop: true, reason: status.blocked_reason ?? 'Blocked' };
    }

    // Human required
    if (status.human_required) {
      return { stop: true, reason: 'Human intervention required' };
    }

    // Max iterations
    if (status.iteration >= config.max_iterations) {
      return {
        stop: true,
        reason: `Maximum iterations reached (${status.iteration}/${config.max_iterations})`,
      };
    }

    return { stop: false };
  }

  determineNextAction(
    status: Status
  ): 'invoke_developer' | 'invoke_reviewer' | 'stop' {
    switch (status.status) {
      case 'needs_fix':
        return 'invoke_developer';
      case 'needs_review':
        return 'invoke_reviewer';
      case 'done':
      case 'blocked':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
