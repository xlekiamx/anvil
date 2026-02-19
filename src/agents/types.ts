import type { QuestionOption } from '../types/status.js';

/** Question detected during interactive execution */
export interface DetectedQuestion {
  sessionId: string;
  question: string;
  options?: QuestionOption[];
}

/** Callback for handling user questions in interactive mode */
export type QuestionHandler = (question: DetectedQuestion) => Promise<string>;

export interface WorkerResult {
  success: boolean;
  output: string;     // pure JSON string from stdout
  error?: string;
  durationMs: number;
  pendingQuestion?: DetectedQuestion;
}

export interface Worker {
  readonly name: string;
  execute(prompt: string, cwd: string): Promise<WorkerResult>;
  /** Kill the running child process if any */
  kill?(): void;
}
