import * as path from 'node:path';
import { execa } from 'execa';
import type { Logger } from '../logger/index.js';
import type { Status } from '../types/status.js';
import type { Worker, QuestionHandler } from '../agents/types.js';
import type { StatusFile } from '../files/status.js';
import type { ConfigFile } from '../files/config.js';
import { StateMachine } from './state-machine.js';
import { buildPrompt } from './prompt-builder.js';
import { parseOutput, validateOutput } from './output-parser.js';
import type { Config } from '../types/config.js';

/** Find the first executor-behavior worker in the workflow. */
function findFirstExecutor(config: Config): string {
  return config.workflow.find(w => {
    const wc = config.workers[w];
    return wc && (wc.behavior ?? 'executor') === 'executor';
  }) ?? config.workflow[0]!;
}

export interface OrchestratorDependencies {
  logger: Logger;
  stateMachine: StateMachine;
  statusFile: StatusFile;
  configFile: ConfigFile;
  workers: Map<string, Worker>;
  questionHandler?: QuestionHandler;
}

export interface OrchestratorResult {
  success: boolean;
  finalStatus: Status;
  totalIterations: number;
  reason: string;
}

export class Orchestrator {
  private running = false;
  private shouldStopFlag = false;
  private sigintHandler: (() => void) | null = null;

  constructor(
    private readonly repoPath: string,
    private readonly deps: OrchestratorDependencies
  ) {}

  async run(): Promise<OrchestratorResult> {
    const { logger, configFile, statusFile, stateMachine } = this.deps;

    this.running = true;
    this.shouldStopFlag = false;

    // Handle SIGINT — kill child processes, don't mutate state
    this.sigintHandler = () => {
      logger.info('SIGINT received, killing workers...');
      for (const worker of this.deps.workers.values()) {
        worker.kill?.();
      }
      this.shouldStopFlag = true;
    };
    process.on('SIGINT', this.sigintHandler);

    const config = await configFile.read();
    let status = await statusFile.read();

    if (!status) {
      throw new Error('No status file found. Run "anvil init" first.');
    }

    logger.info({ turn: status.turn, iteration: status.iteration }, 'Starting orchestration loop');
    logger.debug({ state: status }, 'Initial state');

    const startIteration = status.iteration;

    try {
      while (!this.shouldStopFlag) {
        logger.debug({ state: status }, 'Loop iteration state');

        // Check stop conditions
        const stopCheck = stateMachine.shouldStop(status, config);
        if (stopCheck.stop) {
          logger.info({ reason: stopCheck.reason }, 'Stop condition met');
          return {
            success: status.done,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: stopCheck.reason ?? 'Unknown',
          };
        }

        // Get next worker
        const workerName = stateMachine.getNextWorker(status, config.workflow);
        if (!workerName) {
          return {
            success: status.done,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: 'No more actions',
          };
        }

        const worker = this.deps.workers.get(workerName);
        if (!worker) {
          status = await this.block(status, `Worker '${workerName}' not found`);
          return {
            success: false,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: `Worker '${workerName}' not found`,
          };
        }

        // Get worker config
        const workerConfig = config.workers[workerName];
        if (!workerConfig) {
          status = await this.block(status, `No config for worker '${workerName}'`);
          return {
            success: false,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: `No config for worker '${workerName}'`,
          };
        }

        // Build prompt — workers read files themselves
        const planPath = path.resolve(this.repoPath, config.plan_file);
        const statePath = path.join(this.repoPath, '.ai', 'state.json');

        const prompt = buildPrompt({
          workerConfig,
          planFile: planPath,
          stateFile: statePath,
          notes: status.notes.length > 0 ? status.notes : undefined,
        });

        logger.info({ worker: workerName, iteration: status.iteration }, 'Invoking worker');
        logger.debug({ prompt: prompt.slice(0, 500) }, 'Worker prompt (truncated)');

        // Execute worker
        const result = await worker.execute(prompt, this.repoPath);

        logger.info(
          { worker: workerName, success: result.success, durationMs: result.durationMs },
          'Worker completed'
        );
        logger.debug({ rawOutput: result.output }, 'Worker raw output');

        // Handle pending question (interactive mode)
        if (result.pendingQuestion) {
          if (this.deps.questionHandler) {
            const answer = await this.deps.questionHandler(result.pendingQuestion);
            logger.info({ answer }, 'User provided answer, but session resume not yet wired');
            // For now, continue the loop - in a real implementation we'd resume the session
          } else {
            // Save pending question and pause
            status = await this.deps.statusFile.update({
              pending_question: {
                session_id: result.pendingQuestion.sessionId,
                question: result.pendingQuestion.question,
                options: result.pendingQuestion.options,
                asked_at: new Date().toISOString(),
              },
            });
            return {
              success: false,
              finalStatus: status,
              totalIterations: status.iteration - startIteration,
              reason: 'Waiting for user input',
            };
          }
        }

        if (!result.success) {
          status = await this.block(status, result.error ?? `Worker '${workerName}' failed`);
          return {
            success: false,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: result.error ?? `Worker '${workerName}' failed`,
          };
        }

        // Parse output — retry on failure instead of stopping
        let parsed: Record<string, unknown>;
        try {
          parsed = parseOutput(result.output);
          if (status.parse_error_count > 0) {
            status = await this.deps.statusFile.update({ parse_error_count: 0 });
          }
        } catch (err) {
          const newCount = status.parse_error_count + 1;
          if (newCount <= config.parse_error_retries) {
            logger.warn({ worker: workerName, attempt: newCount, retries: config.parse_error_retries }, 'Invalid JSON output, retrying worker');
            status = await this.deps.statusFile.update({
              parse_error_count: newCount,
              feedback: [{
                description: `Your last response was not valid JSON. You MUST respond with ONLY a JSON object matching the required schema: ${JSON.stringify(workerConfig.output_schema)}`,
                severity: 'high',
              }],
            });
            continue;
          }
          // Retries exhausted — advance to next turn rather than stopping
          logger.warn({ worker: workerName, retries: config.parse_error_retries }, 'JSON parse retries exhausted, advancing to next turn');
          const nextTurnOnFailure = stateMachine.getNextTurn(workerName, config.workflow);
          status = await this.deps.statusFile.update({
            parse_error_count: 0,
            feedback: [],
            turn: nextTurnOnFailure,
          });
          continue;
        }

        // Validate output against worker's output_schema
        let validated: Record<string, unknown>;
        try {
          validated = validateOutput(parsed, workerConfig.output_schema);
        } catch (err) {
          const newCount = status.parse_error_count + 1;
          if (newCount <= config.parse_error_retries) {
            logger.warn({ worker: workerName, attempt: newCount }, 'Schema validation failed, retrying worker');
            status = await this.deps.statusFile.update({
              parse_error_count: newCount,
              feedback: [{
                description: `Your response was missing required fields. You MUST respond with ONLY a JSON object matching the required schema: ${JSON.stringify(workerConfig.output_schema)}`,
                severity: 'high',
              }],
            });
            continue;
          }
          logger.warn({ worker: workerName }, 'Schema validation retries exhausted, advancing to next turn');
          const nextTurnOnFailure = stateMachine.getNextTurn(workerName, config.workflow);
          status = await this.deps.statusFile.update({
            parse_error_count: 0,
            feedback: [],
            turn: nextTurnOnFailure,
          });
          continue;
        }

        // Update state based on worker behavior
        const behavior = workerConfig.behavior ?? 'executor';
        const nextTurn = stateMachine.getNextTurn(workerName, config.workflow);

        logger.debug({ validated, behavior, nextTurn }, 'Parsed worker output');

        if (behavior === 'executor') {
          // Executor: read task_id, notes; update state based on review strategy
          const taskId = typeof validated.task_id === 'string' ? validated.task_id : '';
          const newNotes = Array.isArray(validated.notes)
            ? (validated.notes as unknown[]).filter((n): n is string => typeof n === 'string')
            : [];
          const updatedNotes = newNotes.length > 0 ? [...status.notes, ...newNotes] : undefined;

          if (config.review_strategy === 'batch' && taskId) {
            // Batch mode with a new task: keep executor running
            status = await this.deps.statusFile.update({
              current_task: { id: taskId, status: 'in_progress' },
              batch_pending_review: true,
              feedback: [],
              ...(updatedNotes ? { notes: updatedNotes } : {}),
            });
            logger.info({ taskId }, 'Batch mode: executor continuing with more tasks');
          } else if (config.review_strategy === 'batch' && !taskId) {
            // Batch mode: executor signals no more tasks, advance to reviewer
            status = await this.deps.statusFile.update({
              batch_pending_review: false,
              turn: nextTurn,
              feedback: [],
              ...(updatedNotes ? { notes: updatedNotes } : {}),
            });
            logger.info({ nextTurn }, 'Batch mode: executor done, advancing to reviewer');
          } else {
            // Per-task mode (default): advance to reviewer after each task
            status = await this.deps.statusFile.update({
              current_task: { id: taskId, status: 'in_review' },
              turn: nextTurn,
              feedback: [],
              ...(updatedNotes ? { notes: updatedNotes } : {}),
            });
            logger.info({ taskId, nextTurn }, 'Executor completed, advancing turn');
          }

          logger.debug({ state: status }, 'State after executor');
        } else if (behavior === 'reviewer') {
          // Reviewer: read approved, completed_tasks, done, issues from output
          const approved = typeof validated.approved === 'boolean' ? validated.approved : false;
          const done = typeof validated.done === 'boolean' ? validated.done : false;
          const issues = Array.isArray(validated.issues) ? validated.issues as Array<Record<string, unknown>> : [];
          const completedTasksRaw = Array.isArray(validated.completed_tasks)
            ? (validated.completed_tasks as unknown[]).filter((t): t is string => typeof t === 'string' && t.length > 0)
            : [];
          const confidence = typeof validated.confidence === 'number' ? validated.confidence : 0.7;

          logger.debug({ approved, done, issues, completedTasksRaw, confidence }, 'Validated reviewer output');

          // Check human intervention
          const humanCheck = config.human_intervention
            ? stateMachine.shouldRequestHumanIntervention(validated)
            : { required: false };
          if (humanCheck.required) {
            logger.warn({ reason: humanCheck.reason }, 'Human intervention required');
            const firstExecutor = findFirstExecutor(config);
            status = await this.deps.statusFile.update({
              human_required: true,
              turn: firstExecutor,
              current_task: status.current_task ? {
                ...status.current_task,
                status: 'fixing',
              } : null,
              feedback: issues.map((i) => ({
                description: typeof i.description === 'string' ? i.description : 'No description',
                severity: (typeof i.severity === 'string' ? i.severity : 'medium') as 'critical' | 'high' | 'medium' | 'low',
              })),
            });
            return {
              success: false,
              finalStatus: status,
              totalIterations: status.iteration - startIteration,
              reason: humanCheck.reason ?? 'Human intervention required',
            };
          }

          if (approved) {
            // Commit changes
            if (config.auto_commit) {
              try {
                await execa('git', ['add', '-A'], { cwd: this.repoPath, reject: false });
                const taskId = status.current_task?.id ?? 'task';
                await execa('git', ['commit', '-m', `anvil: task ${taskId}`], {
                  cwd: this.repoPath,
                  reject: false,
                });
              } catch {
                // Commit is best-effort
              }
            }

            // Merge completed tasks — reviewer is source of truth
            const merged = new Set(status.completed_tasks);
            for (const id of completedTasksRaw) {
              merged.add(id);
            }
            if (status.current_task) {
              merged.add(status.current_task.id);
            }
            const completedTasks = [...merged];

            if (done) {
              status = await this.deps.statusFile.update({
                current_task: null,
                completed_tasks: completedTasks,
                feedback: [],
                done: true,
              });

              logger.info(
                { completedCount: completedTasks.length, completedTasks },
                'All plan tasks completed'
              );
              logger.debug({ state: status }, 'Final state');

              return {
                success: true,
                finalStatus: status,
                totalIterations: status.iteration - startIteration,
                reason: 'All plan tasks completed',
              };
            }

            const firstExecutor = findFirstExecutor(config);
            status = await this.deps.statusFile.update({
              current_task: null,
              completed_tasks: completedTasks,
              feedback: [],
              turn: firstExecutor,
              iteration: 0,
            });

            logger.info(
              { completedCount: completedTasks.length, completedTasks },
              'Task approved and committed'
            );
            logger.debug({ state: status }, 'State after approval');

            if (config.loop_mode === 'manual') {
              return {
                success: true,
                finalStatus: status,
                totalIterations: status.iteration - startIteration,
                reason: 'Task completed (manual mode)',
              };
            }
          } else {
            // Reviewer rejected — send back to first executor with feedback
            const firstExecutor = findFirstExecutor(config);
            status = await this.deps.statusFile.update({
              feedback: issues.map((i) => ({
                description: typeof i.description === 'string' ? i.description : 'No description',
                severity: (typeof i.severity === 'string' ? i.severity : 'medium') as 'critical' | 'high' | 'medium' | 'low',
              })),
              turn: firstExecutor,
              iteration: status.iteration + 1,
              current_task: status.current_task ? {
                ...status.current_task,
                status: 'fixing',
              } : null,
            });

            logger.info(
              { issueCount: issues.length, iteration: status.iteration },
              'Reviewer rejected, sending back to executor'
            );
            logger.debug({ state: status }, 'State after rejection');
          }
        }
      }

      // Manual stop
      status = await this.block(status, 'Manual stop requested');
      return {
        success: false,
        finalStatus: status,
        totalIterations: status.iteration - startIteration,
        reason: 'Manual stop',
      };
    } finally {
      this.running = false;
      if (this.sigintHandler) {
        process.removeListener('SIGINT', this.sigintHandler);
        this.sigintHandler = null;
      }
    }
  }

  private async block(_status: Status, reason: string): Promise<Status> {
    const { statusFile, logger } = this.deps;
    const updated = await statusFile.update({ blocked_reason: reason });
    logger.info({ reason }, 'Blocked');
    return updated;
  }

  stop(): void {
    if (this.running) {
      this.shouldStopFlag = true;
    }
  }

  isRunning(): boolean {
    return this.running;
  }
}
