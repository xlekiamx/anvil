import type { Logger } from '../logger/index.js';
import { createLogger } from '../logger/index.js';
import { StateMachine } from './state-machine.js';
import { AiDirectory } from '../files/ai-directory.js';
import { StatusFile } from '../files/status.js';
import { ConfigFile } from '../files/config.js';
import { SpecFile } from '../files/spec.js';
import { ReviewOutputFile } from '../files/review-output.js';
import { DefaultAgentFactory } from '../agents/factory.js';
import { Orchestrator, type OrchestratorDependencies } from './orchestrator.js';
import type { Config } from '../types/config.js';

export interface AnvilContext {
  repoPath: string;
  aiDir: AiDirectory;
  statusFile: StatusFile;
  configFile: ConfigFile;
  specFile: SpecFile;
  reviewOutputFile: ReviewOutputFile;
  logger: Logger;
}

export function createAnvilContext(repoPath: string, logger?: Logger): AnvilContext {
  const log = logger ?? createLogger();
  const aiDir = new AiDirectory(repoPath, log);

  return {
    repoPath,
    aiDir,
    statusFile: new StatusFile(aiDir.path, log),
    configFile: new ConfigFile(aiDir.path, log),
    specFile: new SpecFile(aiDir.path, log),
    reviewOutputFile: new ReviewOutputFile(aiDir.path, log),
    logger: log,
  };
}

export function createOrchestrator(
  context: AnvilContext,
  config: Config
): Orchestrator {
  const agentFactory = new DefaultAgentFactory();

  const deps: OrchestratorDependencies = {
    logger: context.logger,
    stateMachine: new StateMachine(),
    statusFile: context.statusFile,
    configFile: context.configFile,
    specFile: context.specFile,
    reviewOutputFile: context.reviewOutputFile,
    developerAgent: agentFactory.createDeveloper(config),
    reviewerAgent: agentFactory.createReviewer(config),
  };

  return new Orchestrator(context.repoPath, deps);
}
