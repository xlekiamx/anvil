export interface CoderOutput {
  task_id: string;
  status: string;
}

export interface ReviewerIssue {
  description: string;
  severity: string;
}

export interface ReviewerOutput {
  approved: boolean;
  done: boolean;
  issues: ReviewerIssue[];
  confidence: number;
}

export function parseOutput(stdout: string): Record<string, unknown> {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error('Empty output from worker');
  }

  // Strategy 1: Try direct parse (pure JSON output)
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Not pure JSON, try extraction strategies
  }

  // Strategy 2: Extract JSON from markdown code block
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch?.[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1]) as Record<string, unknown>;
    } catch {
      // Code block content isn't valid JSON
    }
  }

  // Strategy 3: Find first { ... } JSON object in the text
  const jsonObjMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjMatch) {
    try {
      return JSON.parse(jsonObjMatch[0]) as Record<string, unknown>;
    } catch {
      // Found braces but not valid JSON
    }
  }

  throw new Error(`Invalid JSON output from worker: ${trimmed.slice(0, 200)}`);
}

export function validateCoderOutput(parsed: Record<string, unknown>): CoderOutput {
  if (typeof parsed.task_id !== 'string' || !parsed.task_id) {
    throw new Error('Coder output missing required field: task_id');
  }
  if (typeof parsed.status !== 'string' || !parsed.status) {
    throw new Error('Coder output missing required field: status');
  }

  return {
    task_id: parsed.task_id,
    status: parsed.status,
  };
}

export function validateReviewerOutput(parsed: Record<string, unknown>): ReviewerOutput {
  if (typeof parsed.approved !== 'boolean') {
    throw new Error('Reviewer output missing required field: approved');
  }
  if (!Array.isArray(parsed.issues)) {
    throw new Error('Reviewer output missing required field: issues');
  }

  const issues: ReviewerIssue[] = parsed.issues.map((issue: unknown, index: number) => {
    if (typeof issue !== 'object' || issue === null) {
      throw new Error(`Reviewer output issue[${index}] is not an object`);
    }
    const obj = issue as Record<string, unknown>;
    return {
      description: typeof obj.description === 'string' ? obj.description : 'No description',
      severity: typeof obj.severity === 'string' ? obj.severity : 'medium',
    };
  });

  return {
    approved: parsed.approved,
    done: typeof parsed.done === 'boolean' ? parsed.done : false,
    issues,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.7,
  };
}
