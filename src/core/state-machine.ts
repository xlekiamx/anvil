import type { Status } from '../types/status.js';
import type { Config } from '../types/config.js';
import type { ReviewerOutput } from './output-parser.js';

export class StateMachine {
  /**
   * Get the next worker name from state.turn, or null if done/stopped.
   */
  getNextWorker(state: Status, workflow: string[]): string | null {
    if (state.done) return null;
    if (state.human_required) return null;
    if (state.blocked_reason) return null;

    // Validate turn is in workflow
    if (!workflow.includes(state.turn)) return null;

    return state.turn;
  }

  /**
   * Advance turn to the next worker in the workflow array.
   */
  getNextTurn(currentTurn: string, workflow: string[]): string {
    const idx = workflow.indexOf(currentTurn);
    if (idx === -1 || idx === workflow.length - 1) {
      return workflow[0]!;
    }
    return workflow[idx + 1]!;
  }

  /**
   * Check if the orchestrator should stop.
   */
  shouldStop(
    state: Status,
    config: Config
  ): { stop: boolean; reason?: string } {
    if (state.done) {
      return { stop: true, reason: 'All tasks completed' };
    }

    if (state.blocked_reason) {
      return { stop: true, reason: state.blocked_reason };
    }

    if (state.human_required) {
      return { stop: true, reason: 'Human intervention required' };
    }

    if (state.iteration >= config.max_iterations_per_task) {
      return {
        stop: true,
        reason: `Maximum iterations per task reached (${state.iteration}/${config.max_iterations_per_task})`,
      };
    }

    return { stop: false };
  }

  /**
   * Check if reviewer output warrants human intervention.
   */
  shouldRequestHumanIntervention(
    reviewerOutput: ReviewerOutput
  ): { required: boolean; reason?: string } {
    // Critical issues require human
    const critical = reviewerOutput.issues.find(
      (i) => i.severity === 'critical'
    );
    if (critical) {
      return {
        required: true,
        reason: `Critical issue found: ${critical.description}`,
      };
    }

    // Very low confidence
    if (reviewerOutput.confidence < 0.3) {
      return {
        required: true,
        reason: `Very low confidence: ${reviewerOutput.confidence.toFixed(2)}`,
      };
    }

    return { required: false };
  }
}
