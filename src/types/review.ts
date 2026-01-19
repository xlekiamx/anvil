import { z } from 'zod';
import { IssueCategorySchema } from './config.js';

export const IssueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const ReviewIssueSchema = z.object({
  id: z.string(),
  severity: IssueSeveritySchema,
  category: IssueCategorySchema,
  description: z.string(),
  file: z.string().optional(),
  line: z.number().int().optional(),
});
export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

export const ReviewOutputSchema = z.object({
  approved: z.boolean(),
  issues: z.array(ReviewIssueSchema).default([]),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  request_human: z.boolean().default(false),
});
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
