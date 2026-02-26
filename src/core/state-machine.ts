import type { Status } from '../types/status.js';
import type { Config } from '../types/config.js';

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
   * In batch mode, returns true when the executor is still running tasks
   * and the reviewer should be skipped until the executor signals done.
   */
  shouldSkipReviewer(status: Status, config: Config): boolean {
    return config.review_strategy === 'batch' && status.batch_pending_review;
  }

  /**
   * Check if output warrants human intervention.
   * Looks for critical severity in any `issues` array and low `confidence`.
   */
  shouldRequestHumanIntervention(
    output: Record<string, unknown>
  ): { required: boolean; reason?: string } {
    // Check for critical issues if issues array exists
    if (Array.isArray(output.issues)) {
      const critical = (output.issues as Array<Record<string, unknown>>).find(
        (i) => i.severity === 'critical'
      );
      if (critical) {
        return {
          required: true,
          reason: `Critical issue found: ${typeof critical.description === 'string' ? critical.description : 'Unknown'}`,
        };
      }
    }

    // Very low confidence
    if (typeof output.confidence === 'number' && output.confidence < 0.3) {
      return {
        required: true,
        reason: `Very low confidence: ${output.confidence.toFixed(2)}`,
      };
    }

    return { required: false };
  }
}
