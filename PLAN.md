# Plan: Generic Multi-Worker Orchestration

## Problem

The orchestrator is hardcoded for a 2-worker coder/reviewer pattern. The `isFirstWorker` branching in the prompt builder and orchestrator, the `CoderOutput`/`ReviewerOutput` types, and the state update logic all assume specific roles. This prevents reusing the same orchestrator for different workflows (e.g. plan generation, spec writing, code implementation) by just swapping config.

## Design

### Two behaviors: `executor` and `reviewer`

- **`executor`** — does work. Could be coding, generating a plan, writing specs, creating tests. Returns `task_id` of what it worked on. Sets `current_task`, advances turn.
- **`reviewer`** — reviews the executor's work. Could be reviewing code, a plan, specs. Returns `approved`, `completed_tasks`, `done`, `issues`. Handles approve/reject/commit flow.

### Prompt files instead of hardcoded prompt text

Each worker config points to a prompt file (`prompt_file` field). The prompt builder reads the file and appends context (file paths, output schema hint). Different workflows use different prompt files.

Example: a coding workflow uses `prompts/coder.md` and `prompts/code-reviewer.md`. A planning workflow uses `prompts/planner.md` and `prompts/plan-reviewer.md`. The user swaps by changing config.

### Multiple configs via flag

Support `anvil start --config <name>` to load `.ai/config.<name>.json` instead of `.ai/config.json`. This lets users have `config.json` (default coding workflow), `config.planning.json` (plan generation), etc.

## Tasks

### Task 1: Add `behavior` field to WorkerConfig schema

Add `behavior: z.enum(['executor', 'reviewer']).default('executor')` to `WorkerConfigSchema` in `src/types/config.ts`. Update default config: coder gets `behavior: 'executor'`, reviewer gets `behavior: 'reviewer'`.

**Test first:**
- Valid config with each behavior value parses correctly
- Default behavior is `'executor'` when omitted
- Invalid behavior value fails validation
- getDefaultConfig() returns workers with correct behavior

**Files:** `src/types/config.ts`, `tests/unit/config.test.ts` (new)

---

### Task 2: Rename `review_issues` to `feedback` in status schema

Rename `review_issues` to `feedback` in `StatusSchema` and all references. This field is not reviewer-specific — it's feedback from any reviewer on any type of work.

**Test first:**
- Status schema accepts `feedback` field
- `createInitialStatus` returns empty `feedback` array
- Status round-trips correctly with feedback

**Files:** `src/types/status.ts`, `src/core/orchestrator.ts`, `src/core/prompt-builder.ts`, `src/core/state-machine.ts`, all tests referencing `review_issues`

---

### Task 3: Add `prompt_file` field to WorkerConfig and prompt file loading

Add `prompt_file: z.string().optional()` to `WorkerConfigSchema`. When set, the prompt builder reads the file content and uses it as the prompt base instead of the `role` field. If not set, falls back to `role` string (backwards compatible).

The prompt builder appends to the prompt base:
- "Do not modify the state file" warning with path
- Plan file path and state file path
- Output schema hint

Create default prompt files at init: `prompts/coder.md`, `prompts/code-reviewer.md`.

**Test first:**
- Config with `prompt_file` parses correctly
- Config without `prompt_file` still works (uses role)
- buildPrompt reads from file when prompt_file is set
- buildPrompt falls back to role when prompt_file is not set
- Prompt includes file paths and output schema regardless of source

**Files:** `src/types/config.ts`, `src/core/prompt-builder.ts`, `tests/unit/prompt-builder.test.ts`

---

### Task 4: Remove `isFirstWorker` from prompt builder — make it generic

Remove all coder/reviewer specific prompt text from `buildPrompt`. Remove `isFirstWorker` and `state` from `PromptContext`. The prompt becomes:

1. Prompt base (from `prompt_file` or `role`)
2. "Do not modify state file" + file paths
3. Output schema hint

Move the current hardcoded coder instructions into `prompts/coder.md` and reviewer instructions into `prompts/code-reviewer.md`. These are created at `anvil init`.

**Test first:**
- Prompt includes prompt base from config
- Prompt includes state file and plan file paths
- Prompt includes output schema hint
- Prompt does NOT contain hardcoded coder/reviewer instructions
- No `isFirstWorker` in PromptContext type

**Files:** `src/core/prompt-builder.ts`, `tests/unit/prompt-builder.test.ts`

---

### Task 5: Replace role-specific output validators with generic validation

Remove `CoderOutput`, `ReviewerOutput`, `validateCoderOutput`, `validateReviewerOutput`. Replace with a single `validateOutput(parsed, outputSchema)` that checks required fields exist based on the worker's `output_schema` from config. Return the parsed record as-is.

Keep `parseOutput` (JSON extraction from text) unchanged.

**Test first:**
- `validateOutput({task_id: '1', status: 'completed'}, {task_id: 'string', status: 'string'})` passes
- `validateOutput({}, {task_id: 'string'})` throws (missing required field)
- `validateOutput({approved: true, issues: []}, {approved: 'boolean', issues: []})` passes
- Extra fields in output don't cause errors
- Missing optional-like fields (arrays default empty, booleans default false) handled gracefully

**Files:** `src/core/output-parser.ts`, `tests/unit/output-parser.test.ts`

---

### Task 6: Refactor orchestrator to use behavior-based dispatch

Replace the `if (isFirstWorker) { ... } else { ... }` block with behavior-based dispatch:

```
const behavior = workerConfig.behavior ?? 'executor';
if (behavior === 'executor') { ... }
else if (behavior === 'reviewer') { ... }
```

- **executor**: read `task_id` from parsed output, set `current_task`, advance turn, clear feedback.
- **reviewer**: read `approved`, `completed_tasks`, `done`, `issues` from parsed output. Handle approve (commit + merge completed_tasks + check done), reject (set feedback + increment iteration + find first executor in workflow to loop back to), human intervention check.

Use `validateOutput` instead of `validateCoderOutput`/`validateReviewerOutput`. Extract needed fields from the generic parsed record.

**Test first:**
- Executor behavior: sets current_task from output, advances turn
- Reviewer approve: commits, merges completed_tasks, advances to executor
- Reviewer reject: sets feedback, loops back to first executor, increments iteration
- Reviewer done=true: marks session complete
- Human intervention on critical issues still works
- Rejection loops back to first executor in workflow (not hardcoded workflow[0])

**Files:** `src/core/orchestrator.ts`, `tests/integration/orchestrator.test.ts`

---

### Task 7: Generalize `shouldRequestHumanIntervention` in state machine

Change `shouldRequestHumanIntervention` to accept generic parsed output (`Record<string, unknown>`) instead of `ReviewerOutput`. Check for critical severity in any `issues` array and low confidence if `confidence` field exists.

**Test first:**
- Output with `issues: [{severity: 'critical', ...}]` triggers human intervention
- Output with `confidence: 0.2` triggers human intervention
- Output without `issues` or `confidence` fields does not trigger
- Works with any output shape

**Files:** `src/core/state-machine.ts`, `tests/unit/state-machine.test.ts`

---

### Task 8: Update default config and create default prompt files

Update default config in `src/types/config.ts` with:
- coder: `behavior: 'executor'`, `prompt_file: './prompts/coder.md'`
- reviewer: `behavior: 'reviewer'`, `prompt_file: './prompts/code-reviewer.md'`

Update `anvil init` to create `prompts/` directory with default prompt files:

**prompts/coder.md:**
```
You are a senior software engineer. Implement tasks from the plan.
Read the plan file for the task list. Read the state file for completed tasks and feedback.
If the current task in state has status 'fixing', address the feedback issues.
Otherwise, pick exactly 1 uncompleted task from the plan (not in completed_tasks) and implement it.
Implement only that one task. Write tests for your implementation.
```

**prompts/code-reviewer.md:**
```
You are a staff software engineer reviewing changes for correctness, security, and quality.
Read the state file to get the current task. Read the plan file for task details.
Review ONLY the current task. Do not flag other unimplemented tasks as issues.
For completed_tasks, list all task IDs fully implemented in the codebase.
Set done=true only when ALL plan tasks are in completed_tasks.
```

**Test first:**
- Default config parses with prompt_file and behavior fields
- Init command creates prompts directory with both files
- Prompt files contain expected content

**Files:** `src/types/config.ts`, `src/cli/commands/init.ts`, `tests/unit/config.test.ts`

---

### Task 9: Support `--config` flag for multiple configs

Add `--config <name>` option to `start`, `resume`, `status`, and `reset` commands. When provided, load `.ai/config.<name>.json` instead of `.ai/config.json`. Default is no suffix (loads `.ai/config.json`).

**Test first:**
- ConfigFile accepts optional config name parameter
- ConfigFile with name `'planning'` reads `.ai/config.planning.json`
- ConfigFile with no name reads `.ai/config.json`
- CLI commands pass config name through to context

**Files:** `src/files/config.ts`, `src/cli/commands/start.ts`, `src/cli/commands/resume.ts`, `src/cli/commands/status.ts`, `src/cli/commands/reset.ts`

---

### Task 10: Clean up dead code, update exports, full verification

Remove `CoderOutput`, `ReviewerOutput` type exports. Remove `validateCoderOutput`, `validateReviewerOutput` exports. Remove `isFirstWorker` from any remaining references. Update barrel exports.

**Test first:**
- `npm run build` succeeds with zero errors
- All tests pass (unit + integration)
- No unused exports or dead code

**Files:** `src/core/output-parser.ts`, `src/core/index.ts`, any barrel files
