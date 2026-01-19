import type { Logger } from '../logger/index.js';
import type { Status } from '../types/status.js';
import type { Config } from '../types/config.js';
import type { DeveloperAgent, ReviewerAgent, AgentContext } from '../agents/types.js';
import type { StatusFile } from '../files/status.js';
import type { ConfigFile } from '../files/config.js';
import type { SpecFile } from '../files/spec.js';
import type { ReviewOutputFile } from '../files/review-output.js';
import { StateMachine } from './state-machine.js';

export interface OrchestratorDependencies {
  logger: Logger;
  stateMachine: StateMachine;
  statusFile: StatusFile;
  configFile: ConfigFile;
  specFile: SpecFile;
  reviewOutputFile: ReviewOutputFile;
  developerAgent: DeveloperAgent;
  reviewerAgent: ReviewerAgent;
}

export interface OrchestratorResult {
  success: boolean;
  finalStatus: Status;
  totalIterations: number;
  reason: string;
}

export interface IterationResult {
  status: Status;
  action: 'developer' | 'reviewer';
  success: boolean;
  error?: string;
}

export class Orchestrator {
  private running = false;
  private shouldStop = false;

  constructor(
    private readonly repoPath: string,
    private readonly deps: OrchestratorDependencies
  ) {}

  async run(): Promise<OrchestratorResult> {
    const { logger, configFile, statusFile, stateMachine } = this.deps;

    this.running = true;
    this.shouldStop = false;

    const config = await configFile.read();
    let status = await statusFile.read();

    if (!status) {
      throw new Error('No status file found. Run "anvil init" first.');
    }

    logger.info(
      { featureId: status.feature_id, iteration: status.iteration },
      'Starting orchestration loop'
    );

    const startIteration = status.iteration;

    try {
      while (!this.shouldStop) {
        // Check stop conditions
        const stopCheck = stateMachine.shouldStop(status, config);
        if (stopCheck.stop) {
          logger.info({ reason: stopCheck.reason }, 'Stop condition met');
          return {
            success: status.status === 'done',
            finalStatus: status,
            totalIterations: status.iteration - startIteration + 1,
            reason: stopCheck.reason ?? 'Unknown',
          };
        }

        // Determine next action
        const nextAction = stateMachine.determineNextAction(status);
        if (nextAction === 'stop') {
          return {
            success: status.status === 'done',
            finalStatus: status,
            totalIterations: status.iteration - startIteration + 1,
            reason: 'No more actions',
          };
        }

        // Map action to iteration type
        const action: 'developer' | 'reviewer' =
          nextAction === 'invoke_developer' ? 'developer' : 'reviewer';

        // Execute iteration
        const result = await this.runIteration(status, config, action);
        status = result.status;

        if (!result.success) {
          logger.warn({ error: result.error }, 'Iteration failed');
        }
      }

      // Manual stop requested
      status = await this.transitionToBlocked(status, 'Manual stop requested');
      return {
        success: false,
        finalStatus: status,
        totalIterations: status.iteration - startIteration + 1,
        reason: 'Manual stop',
      };
    } finally {
      this.running = false;
    }
  }

  async runIteration(
    status: Status,
    config: Config,
    action: 'developer' | 'reviewer'
  ): Promise<IterationResult> {
    const { logger, specFile, reviewOutputFile } = this.deps;

    logger.info(
      { iteration: status.iteration, action },
      `Starting iteration`
    );

    const specContent = await specFile.readOrThrow();
    const reviewOutput = await reviewOutputFile.read();

    const context: AgentContext = {
      repoPath: this.repoPath,
      aiDir: this.deps.statusFile.path.replace('/status.json', ''),
      status,
      config,
      specContent,
      reviewOutput: reviewOutput ?? undefined,
    };

    if (action === 'developer') {
      return this.invokeDeveloper(context, status, config);
    } else {
      return this.invokeReviewer(context, status, config);
    }
  }

  private async invokeDeveloper(
    context: AgentContext,
    status: Status,
    _config: Config
  ): Promise<IterationResult> {
    const { logger, developerAgent, statusFile, stateMachine } = this.deps;

    logger.info({ agent: developerAgent.name }, 'Invoking developer agent');

    const result = await developerAgent.execute(context);

    logger.info(
      { success: result.success, durationMs: result.durationMs },
      'Developer agent completed'
    );

    if (!result.success) {
      const newStatus = await this.transitionToBlocked(
        status,
        result.error ?? 'Developer agent failed'
      );
      return { status: newStatus, action: 'developer', success: false, error: result.error };
    }

    // Update annotations if provided
    if (result.annotations) {
      status = await statusFile.update({ annotations: result.annotations });
    }

    // Transition to needs_review
    let newStatus = stateMachine.transition(status, 'needs_review', 'developer_complete');
    newStatus = { ...newStatus, last_actor: 'developer' };
    await statusFile.write(newStatus);

    logger.info('State transition: needs_fix -> needs_review');

    return { status: newStatus, action: 'developer', success: true };
  }

  private async invokeReviewer(
    context: AgentContext,
    status: Status,
    config: Config
  ): Promise<IterationResult> {
    const { logger, reviewerAgent, statusFile, reviewOutputFile, stateMachine } = this.deps;

    logger.info({ agent: reviewerAgent.name }, 'Invoking reviewer agent');

    const result = await reviewerAgent.execute(context);

    logger.info(
      { success: result.success, durationMs: result.durationMs },
      'Reviewer agent completed'
    );

    if (!result.success || !result.output) {
      const newStatus = await this.transitionToBlocked(
        status,
        result.error ?? 'Reviewer agent failed'
      );
      return { status: newStatus, action: 'reviewer', success: false, error: result.error };
    }

    // Write review output
    await reviewOutputFile.write(result.output);

    // Check if human intervention is required
    const humanCheck = stateMachine.shouldRequestHumanIntervention(result.output, config);
    if (humanCheck.required) {
      logger.warn({ reason: humanCheck.reason }, 'Human intervention required');
      await this.transitionToBlocked(status, humanCheck.reason ?? 'Human required');
      const finalStatus = await statusFile.update({ human_required: true });
      return { status: finalStatus, action: 'reviewer', success: true };
    }

    // Determine next state based on approval
    let newStatus: Status;
    if (result.output.approved) {
      newStatus = stateMachine.transition(status, 'done', 'approved');
      newStatus = { ...newStatus, last_actor: 'reviewer', done: true };
      logger.info('Feature approved! State transition: needs_review -> done');
    } else {
      newStatus = stateMachine.transition(status, 'needs_fix', 'issues_found');
      newStatus = {
        ...newStatus,
        last_actor: 'reviewer',
        iteration: status.iteration + 1,
      };
      logger.info(
        { issueCount: result.output.issues.length },
        'Issues found. State transition: needs_review -> needs_fix'
      );
    }

    await statusFile.write(newStatus);

    return { status: newStatus, action: 'reviewer', success: true };
  }

  private async transitionToBlocked(status: Status, reason: string): Promise<Status> {
    const { statusFile, stateMachine, logger } = this.deps;

    const newStatus = stateMachine.transition(status, 'blocked', 'blocked');
    const finalStatus: Status = {
      ...newStatus,
      last_actor: 'orchestrator',
      blocked_reason: reason,
    };

    await statusFile.write(finalStatus);
    logger.info({ reason }, 'State transition: -> blocked');

    return finalStatus;
  }

  stop(): void {
    if (this.running) {
      this.shouldStop = true;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
