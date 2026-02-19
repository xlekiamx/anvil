import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execa } from 'execa';
import type { Logger } from '../logger/index.js';
import type { Status } from '../types/status.js';
import type { Worker, QuestionHandler } from '../agents/types.js';
import type { StatusFile } from '../files/status.js';
import type { ConfigFile } from '../files/config.js';
import { StateMachine } from './state-machine.js';
import { buildPrompt } from './prompt-builder.js';
import { parseOutput, validateCoderOutput, validateReviewerOutput } from './output-parser.js';

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

    const startIteration = status.iteration;

    try {
      while (!this.shouldStopFlag) {
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

        // Read plan file
        const planPath = path.resolve(this.repoPath, config.plan_file);
        let planContent: string;
        try {
          planContent = await fs.readFile(planPath, 'utf-8');
        } catch {
          status = await this.block(status, `Plan file not found: ${config.plan_file}`);
          return {
            success: false,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: `Plan file not found: ${config.plan_file}`,
          };
        }

        // Get git diff for non-coder workers
        let gitDiff: string | undefined;
        if (workerName !== config.workflow[0]) {
          try {
            const diffResult = await execa('git', ['diff', '--cached'], {
              cwd: this.repoPath,
              reject: false,
            });
            if (diffResult.stdout) {
              gitDiff = diffResult.stdout;
            } else {
              // Also try unstaged diff
              const unstaged = await execa('git', ['diff'], {
                cwd: this.repoPath,
                reject: false,
              });
              gitDiff = unstaged.stdout || undefined;
            }
          } catch {
            // Git diff is optional
          }
        }

        // Build prompt
        const prompt = buildPrompt({
          workerConfig,
          state: status,
          planContent,
          gitDiff,
        });

        logger.info({ worker: workerName, iteration: status.iteration }, 'Invoking worker');

        // Execute worker
        const result = await worker.execute(prompt, this.repoPath);

        logger.info(
          { worker: workerName, success: result.success, durationMs: result.durationMs },
          'Worker completed'
        );

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

        // Parse output
        let parsed: Record<string, unknown>;
        try {
          parsed = parseOutput(result.output);
        } catch (err) {
          status = await this.block(status, `Failed to parse ${workerName} output: ${(err as Error).message}`);
          return {
            success: false,
            finalStatus: status,
            totalIterations: status.iteration - startIteration,
            reason: `Failed to parse ${workerName} output`,
          };
        }

        // Update state based on which worker just ran
        const isFirstWorker = workerName === config.workflow[0];
        const nextTurn = stateMachine.getNextTurn(workerName, config.workflow);

        if (isFirstWorker) {
          // Coder just ran
          const coderOutput = validateCoderOutput(parsed);

          status = await this.deps.statusFile.update({
            current_task: {
              id: coderOutput.task_id,
              status: 'in_review',
            },
            turn: nextTurn,
            review_issues: [],
          });

          logger.info(
            { taskId: coderOutput.task_id, nextTurn },
            'Coder completed, moving to review'
          );
        } else {
          // Reviewer just ran
          const reviewerOutput = validateReviewerOutput(parsed);

          // Check human intervention
          const humanCheck = stateMachine.shouldRequestHumanIntervention(reviewerOutput);
          if (humanCheck.required) {
            logger.warn({ reason: humanCheck.reason }, 'Human intervention required');
            const firstWorker = config.workflow[0]!;
            status = await this.deps.statusFile.update({
              human_required: true,
              turn: firstWorker,
              current_task: status.current_task ? {
                ...status.current_task,
                status: 'fixing',
              } : null,
              review_issues: reviewerOutput.issues.map((i) => ({
                description: i.description,
                severity: i.severity as 'critical' | 'high' | 'medium' | 'low',
              })),
            });
            return {
              success: false,
              finalStatus: status,
              totalIterations: status.iteration - startIteration,
              reason: humanCheck.reason ?? 'Human intervention required',
            };
          }

          if (reviewerOutput.approved) {
            // Commit changes
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

            // Move task to completed
            const completedTasks = [...status.completed_tasks];
            if (status.current_task) {
              completedTasks.push(status.current_task.id);
            }

            // Reviewer signals all plan tasks are done
            if (reviewerOutput.done) {
              status = await this.deps.statusFile.update({
                current_task: null,
                completed_tasks: completedTasks,
                review_issues: [],
                done: true,
              });

              logger.info(
                { completedCount: completedTasks.length },
                'All plan tasks completed'
              );

              return {
                success: true,
                finalStatus: status,
                totalIterations: status.iteration - startIteration,
                reason: 'All plan tasks completed',
              };
            }

            // Reset for next task
            const firstWorker = config.workflow[0]!;
            status = await this.deps.statusFile.update({
              current_task: null,
              completed_tasks: completedTasks,
              review_issues: [],
              turn: firstWorker,
              iteration: 0,
            });

            logger.info(
              { completedCount: completedTasks.length },
              'Task approved and committed'
            );

            // In manual loop mode, stop after each task completion
            if (config.loop_mode === 'manual') {
              return {
                success: true,
                finalStatus: status,
                totalIterations: status.iteration - startIteration,
                reason: 'Task completed (manual mode)',
              };
            }
          } else {
            // Reviewer rejected - send back to coder with issues
            const firstWorker = config.workflow[0]!;
            status = await this.deps.statusFile.update({
              review_issues: reviewerOutput.issues.map((i) => ({
                description: i.description,
                severity: i.severity as 'critical' | 'high' | 'medium' | 'low',
              })),
              turn: firstWorker,
              iteration: status.iteration + 1,
              current_task: status.current_task ? {
                ...status.current_task,
                status: 'fixing',
              } : null,
            });

            logger.info(
              { issueCount: reviewerOutput.issues.length, iteration: status.iteration },
              'Reviewer rejected, sending back to coder'
            );
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
