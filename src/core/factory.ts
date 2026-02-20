import type { Logger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';
import { AiDirectory } from '../files/ai-directory.js';
import { StatusFile } from '../files/status.js';
import { ConfigFile } from '../files/config.js';
import { Orchestrator, type OrchestratorDependencies } from './orchestrator.js';
import { StateMachine } from './state-machine.js';
import { createWorkers } from '../agents/factory.js';
import type { Config } from '../types/config.js';
import type { QuestionHandler } from '../agents/types.js';

export interface AnvilContext {
  repoPath: string;
  aiDir: AiDirectory;
  statusFile: StatusFile;
  configFile: ConfigFile;
  logger: Logger;
}

export function createAnvilContext(repoPath: string, logger?: Logger, configName?: string): AnvilContext {
  const log = logger ?? createLogger();
  const aiDir = new AiDirectory(repoPath, log);

  return {
    repoPath,
    aiDir,
    statusFile: new StatusFile(aiDir.path, log),
    configFile: new ConfigFile(aiDir.path, log, configName),
    logger: log,
  };
}

export interface OrchestratorOptions {
  questionHandler?: QuestionHandler;
}

export function createOrchestrator(
  context: AnvilContext,
  config: Config,
  options: OrchestratorOptions = {}
): Orchestrator {
  const workers = createWorkers(config.workers);

  const deps: OrchestratorDependencies = {
    logger: context.logger,
    stateMachine: new StateMachine(),
    statusFile: context.statusFile,
    configFile: context.configFile,
    workers,
    questionHandler: options.questionHandler,
  };

  return new Orchestrator(context.repoPath, deps);
}
