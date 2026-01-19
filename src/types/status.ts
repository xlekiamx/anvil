import { z } from 'zod';

export const WorkflowStatusSchema = z.enum([
  'needs_fix',
  'needs_review',
  'done',
  'blocked',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

export const ActorSchema = z.enum([
  'developer',
  'reviewer',
  'orchestrator',
  'human',
]);
export type Actor = z.infer<typeof ActorSchema>;

export const StatusSchema = z.object({
  feature_id: z.string().min(1),
  status: WorkflowStatusSchema,
  iteration: z.number().int().min(0),
  last_actor: ActorSchema,
  human_required: z.boolean(),
  done: z.boolean(),
  annotations: z.string().optional(),
  blocked_reason: z.string().optional(),
  started_at: z.string().datetime().optional(),
  updated_at: z.string().datetime(),
});
export type Status = z.infer<typeof StatusSchema>;

export interface StateTransition {
  from: WorkflowStatus;
  to: WorkflowStatus;
  trigger: string;
}

export function createInitialStatus(featureId: string): Status {
  const now = new Date().toISOString();
  return {
    feature_id: featureId,
    status: 'needs_fix',
    iteration: 1,
    last_actor: 'orchestrator',
    human_required: false,
    done: false,
    started_at: now,
    updated_at: now,
  };
}
