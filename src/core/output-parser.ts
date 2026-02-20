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

export function validateOutput(
  parsed: Record<string, unknown>,
  outputSchema: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...parsed };

  for (const [key, schemaValue] of Object.entries(outputSchema)) {
    if (key in result) {
      continue;
    }

    // Provide defaults for missing fields based on schema type
    if (Array.isArray(schemaValue)) {
      result[key] = [];
    } else if (schemaValue === 'boolean') {
      result[key] = false;
    } else if (typeof schemaValue === 'string' && schemaValue.startsWith('number')) {
      throw new Error(`Output missing required field: ${key}`);
    } else if (typeof schemaValue === 'string') {
      throw new Error(`Output missing required field: ${key}`);
    }
  }

  return result;
}
