import { z } from 'zod';

export const QuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string().optional(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const PendingQuestionSchema = z.object({
  session_id: z.string(),
  question: z.string(),
  options: z.array(QuestionOptionSchema).optional(),
  asked_at: z.string().datetime(),
});
export type PendingQuestion = z.infer<typeof PendingQuestionSchema>;

export const ReviewIssueSchema = z.object({
  description: z.string(),
  severity: z.enum(['critical', 'high', 'medium', 'low']),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const CurrentTaskSchema = z.object({
  id: z.string(),
  status: z.enum(['in_progress', 'in_review', 'fixing']),
});
export type CurrentTask = z.infer<typeof CurrentTaskSchema>;

export const StatusSchema = z.object({
  plan_file: z.string(),
  turn: z.string(),
  current_task: CurrentTaskSchema.nullable().default(null),
  feedback: z.array(ReviewIssueSchema).default([]),
  completed_tasks: z.array(z.string()).default([]),
  iteration: z.number().int().min(0),
  done: z.boolean(),
  human_required: z.boolean(),
  blocked_reason: z.string().nullable().default(null),
  pending_question: PendingQuestionSchema.nullable().default(null),
  started_at: z.string().datetime().optional(),
  updated_at: z.string().datetime(),
});
export type Status = z.infer<typeof StatusSchema>;

export function createInitialStatus(planFile: string, firstWorker: string): Status {
  const now = new Date().toISOString();
  return {
    plan_file: planFile,
    turn: firstWorker,
    current_task: null,
    feedback: [],
    completed_tasks: [],
    iteration: 0,
    done: false,
    human_required: false,
    blocked_reason: null,
    pending_question: null,
    started_at: now,
    updated_at: now,
  };
}
