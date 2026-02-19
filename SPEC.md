# Anvil - Generic Worker-Based Multi-Agent Orchestration

## 1. Overview

Anvil is a local, deterministic, multi-agent orchestration system that coordinates generic workers in a turn-based loop with minimal human intervention.

### Core Principles

- **Local-first**: No GitHub Actions, no CI dependency
- **Deterministic**: State-driven, inspectable, restartable at any point
- **Multi-repo safe**: One repo = one isolated loop, no cross-pollution
- **Generic workers**: Workers are defined by provider + role in config, not code
- **Dumb orchestrator**: Calls workers based on `turn`, parses JSON output, updates shared state

### What Anvil Is NOT

- A chatbot
- A fully autonomous AI
- A CI replacement
- A magic code generator

---

## 2. Architecture

### 2.1 Components

| Component | Role | Technology |
|-----------|------|------------|
| **Orchestrator** | Dumb state machine — calls workers based on turn, parses JSON, updates state | Node.js (non-LLM) |
| **Workers** | Generic agents — receive a prompt, return JSON output | Configurable (Claude, Codex, mock) |

### 2.2 Design Philosophy

- **Workers are generic** — defined by `provider` + `role` + `output_schema` in config
- **Workers are dumb** — they receive a prompt, return JSON output. They don't decide workflow.
- **Orchestrator is a dumb state machine** — calls workers based on `turn`, parses their JSON output, updates shared state file
- **Coder picks tasks** — orchestrator says "implement the plan", coder picks a task and reports back
- **Shared state file is the communication channel** — workers read it (via prompt), orchestrator writes it
- **Commits happen after reviewer approves** — not by the coder
- **Worker output is pure JSON** — each role has an output schema. No heuristic parsing.

### 2.3 Communication Model

- **No worker-to-worker direct communication**
- Workers communicate indirectly via the orchestrator's prompt (which includes state context)
- Orchestrator owns the state file — workers never write to it directly
- Workers return pure JSON output — orchestrator parses and acts on it

---

## 3. File Structure

Each repository contains its own AI control directory:

```
.ai/
├── config.json          # Per-repo configuration (workers, workflow, plan_file)
└── state.json           # Workflow state (orchestrator-owned)
```

The plan file (e.g., `./PLAN.md`) lives wherever configured — typically at the repo root.

### 3.0 File Ownership

| File | Write | Read |
|------|-------|------|
| `state.json` | Orchestrator only | Orchestrator (workers read via prompt) |
| `config.json` | User (manual) | Orchestrator |
| Plan file (e.g., `PLAN.md`) | User | Orchestrator (included in worker prompts) |

### 3.1 config.json (Per-Repo Configuration)

```json
{
  "workers": {
    "coder": {
      "provider": "claude",
      "role": "You are a senior developer. Implement tasks from the plan.",
      "model": "opus",
      "interactive": true,
      "output_schema": {
        "task_id": "string",
        "task_description": "string",
        "status": "completed | needs_review"
      }
    },
    "reviewer": {
      "provider": "codex",
      "role": "You are a code reviewer. Review changes for correctness, security, and quality.",
      "output_schema": {
        "approved": "boolean",
        "issues": [{ "description": "string", "severity": "critical | high | medium | low" }],
        "confidence": "number 0-1"
      }
    }
  },
  "plan_file": "./PLAN.md",
  "workflow": ["coder", "reviewer"],
  "loop_mode": "auto",
  "max_iterations_per_task": 6
}
```

**Worker Configuration Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `provider` | string | - | Provider: `claude`, `codex`, or `mock` |
| `role` | string | - | System prompt defining the worker's role |
| `model` | string | - | Override default model (optional) |
| `interactive` | boolean | `false` | Enable interactive Q&A mode |
| `output_schema` | object | `{}` | Expected JSON output shape (included in prompt) |

**Top-Level Configuration:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `plan_file` | string | `./PLAN.md` | Path to the plan file |
| `workflow` | string[] | `["coder", "reviewer"]` | Turn order — worker names from the `workers` map |
| `loop_mode` | string | `auto` | `auto` = continuous loop, `manual` = pause after each task |
| `max_iterations_per_task` | number | `6` | Max coder→reviewer cycles before stopping |

### 3.2 state.json (Shared State File)

Single source of truth for workflow state. Orchestrator-owned.

```json
{
  "plan_file": "./PLAN.md",
  "turn": "coder",
  "current_task": {
    "id": "5",
    "description": "Implement rate limiting",
    "status": "in_review"
  },
  "review_issues": [
    { "description": "Missing edge case", "severity": "high" }
  ],
  "completed_tasks": [
    { "id": "1", "description": "Setup project structure" },
    { "id": "2", "description": "Add auth middleware" }
  ],
  "iteration": 2,
  "done": false,
  "human_required": false,
  "blocked_reason": null,
  "pending_question": null
}
```

**State Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `plan_file` | string | Path to the plan file |
| `turn` | string | Name of the worker whose turn it is |
| `current_task` | object\|null | Task currently being worked on (`id`, `description`, `status`) |
| `review_issues` | array | Issues from the last review |
| `completed_tasks` | array | Tasks that have been approved and committed |
| `iteration` | number | Current iteration count (resets per task) |
| `done` | boolean | Whether all tasks are complete |
| `human_required` | boolean | Whether human intervention is needed |
| `blocked_reason` | string\|null | Why the loop is blocked |
| `pending_question` | object\|null | Pending interactive question from a worker |

---

## 4. Worker Interface

### 4.1 Generic Worker

```typescript
interface Worker {
  readonly name: string;
  execute(prompt: string, cwd: string): Promise<WorkerResult>;
}

interface WorkerResult {
  success: boolean;
  output: string;     // pure JSON string from stdout
  error?: string;
  durationMs: number;
  pendingQuestion?: DetectedQuestion;
}
```

### 4.2 Worker JSON Output Formats

**Coder output:**
```json
{
  "task_id": "5",
  "task_description": "Implement rate limiting middleware",
  "status": "completed"
}
```

**Reviewer output:**
```json
{
  "approved": false,
  "issues": [
    { "description": "Rate limiter is not concurrency-safe", "severity": "high" }
  ],
  "confidence": 0.85
}
```

### 4.3 Providers

| Provider | Implementation | Usage |
|----------|---------------|-------|
| `claude` | Claude Code CLI (`claude -p`) | Interactive/non-interactive development |
| `codex` | Codex CLI (`codex exec`) | Code review |
| `mock` | Configurable mock | Testing |

---

## 5. Orchestrator Loop

### 5.1 Main Loop

```
1. Read state.json
2. Check stop conditions (done, blocked, human_required, max iterations)
3. Read `turn` from state → look up worker by name
4. Build prompt:
   - Worker's role (from config)
   - Plan content (from plan_file)
   - State context (completed tasks, current task, review issues)
   - Git diff (for non-coder workers)
   - Output schema template
5. Call worker.execute(prompt, repoPath) → get JSON output
6. Parse JSON output, validate against expected schema
7. Update state based on turn:
   - Coder turn: set current_task from output, advance turn to reviewer
   - Reviewer approves: git commit, move task to completed_tasks, reset turn to coder
   - Reviewer rejects: set review_issues, increment iteration, reset turn to coder
8. Write state.json
9. If loop_mode = manual: pause after each task completion
10. If interactive and question detected: pause, collect answer
11. Loop until stop condition
```

### 5.2 Turn Transitions

| After | If | Then |
|-------|-----|------|
| Coder completes | — | `turn` → next worker in workflow (reviewer) |
| Reviewer approves | — | Commit changes, move task to completed, `turn` → first worker (coder) |
| Reviewer rejects | — | Set review_issues, increment iteration, `turn` → first worker (coder) |

### 5.3 Stop Conditions

The loop terminates when:
1. **Done**: `done = true`
2. **Blocked**: `blocked_reason` is set
3. **Human required**: `human_required = true`
4. **Max iterations**: `iteration >= max_iterations_per_task`

---

## 6. CLI Interface

### 6.1 Commands

```bash
# Initialize a repo for Anvil
anvil init

# Start the orchestration loop
anvil start

# Check current status
anvil status
anvil status --json

# Stop the running loop
anvil stop
anvil stop --reason "Need to rethink approach"

# Resume a paused session
anvil resume
```

### 6.2 Command Details

**`anvil init`**
- Creates `.ai/` directory
- Generates `config.json` with default workers (claude coder + codex reviewer)
- User must create their own plan file (e.g., `PLAN.md`)

**`anvil start`**
- Loads config from `.ai/config.json`
- Validates plan file exists at configured `plan_file` path
- Creates initial `state.json`
- Starts orchestration loop

**`anvil status`**
- Displays: current task, completed tasks count, turn (next worker), iteration, review issues

**`anvil stop`**
- Sets `blocked_reason` in state
- Preserves current state for resume

**`anvil resume`**
- Resumes from blocked/human_required state
- Handles pending interactive questions

---

## 7. Interactive Mode

Interactive mode enables real-time clarification between Claude and the user during development.

### 7.1 Configuration

Enable interactive mode on a worker:

```json
{
  "workers": {
    "coder": {
      "provider": "claude",
      "interactive": true
    }
  }
}
```

### 7.2 Flow

When Claude uses the `AskUserQuestion` tool:
1. Orchestrator detects the question in the stream
2. Pauses execution and displays the question to the user
3. Collects the user's answer via terminal input
4. Resumes the session with the answer

### 7.3 Pending Questions

When a question is asked, it's recorded in `state.json`:

```json
{
  "pending_question": {
    "session_id": "abc123",
    "question": "Which authentication method should be used?",
    "options": [
      {"label": "JWT tokens", "description": "Stateless, scalable"},
      {"label": "Session cookies", "description": "Traditional, simpler"}
    ],
    "asked_at": "2024-01-15T10:30:45Z"
  }
}
```

This allows resuming an interrupted session later with `anvil resume`.

---

## 8. Human Intervention

### 8.1 Triggers

The orchestrator sets `human_required: true` when:

1. **Critical issues**: Reviewer reports issues with `severity: "critical"`
2. **Very low confidence**: Reviewer's `confidence` score below 0.3

### 8.2 Resolution Flow

1. Orchestrator sets `human_required = true`
2. Human reviews state and code
3. Human runs `anvil resume` to continue

---

## 9. Example Session

```bash
# Initialize project
$ anvil init
✓ Created .ai directory
✓ Created config.json

# Create a plan
$ cat PLAN.md
# Plan
- [ ] Task 1: Setup project structure
- [ ] Task 2: Add auth middleware
- [ ] Task 3: Add rate limiting

# Start orchestration
$ anvil start
✓ Started new session (first worker: coder)
Running orchestration loop...

# Check status mid-run
$ anvil status
Turn: reviewer
Iteration: 1
Current Task: [1] Setup project structure (in_review)
Completed Tasks: 0

# Final result
Orchestration completed successfully!
Reason: Task completed (manual mode)
Total Iterations: 2
Turn: coder
Completed Tasks: 3
  - [1] Setup project structure
  - [2] Add auth middleware
  - [3] Add rate limiting
Done: Yes
```

---

## 10. Technical Requirements

### 10.1 Runtime

- Node.js 20+ (LTS)
- npm

### 10.2 External Dependencies

- Claude Code CLI (for `claude` provider)
- Codex CLI (for `codex` provider)
- Git (for diff analysis and commits)

### 10.3 Project Dependencies

- `zod` — Runtime schema validation
- `commander` — CLI framework
- `execa` — Subprocess execution
- `chalk` — Terminal formatting
- `ora` — Spinners
- `pino` — Logging

---

## 11. Source Structure

```
src/
├── agents/
│   ├── types.ts              # Worker interface, WorkerResult, DetectedQuestion
│   ├── factory.ts            # Provider registry (createWorker, createWorkers)
│   ├── index.ts              # Barrel exports
│   └── providers/
│       ├── claude.ts          # Claude Code CLI worker + stream parsing
│       ├── codex.ts           # Codex CLI worker
│       └── mock.ts            # Configurable mock worker
├── cli/
│   ├── index.ts              # Commander.js CLI setup
│   ├── output.ts             # Terminal formatting
│   ├── user-input.ts         # Interactive question prompts
│   └── commands/
│       ├── init.ts
│       ├── start.ts
│       ├── status.ts
│       ├── stop.ts
│       └── resume.ts
├── core/
│   ├── state-machine.ts      # Turn-based state transitions
│   ├── orchestrator.ts       # Main orchestration loop
│   ├── factory.ts            # Dependency injection factory
│   ├── prompt-builder.ts     # Builds prompts from role + state + plan + schema
│   ├── output-parser.ts      # Parses and validates worker JSON output
│   └── index.ts              # Barrel exports
├── files/
│   ├── ai-directory.ts       # .ai directory management
│   ├── status.ts             # state.json CRUD
│   ├── config.ts             # config.json CRUD
│   └── index.ts              # Barrel exports
├── logger/
│   └── index.ts              # Pino logger
├── types/
│   ├── config.ts             # Config schema (workers, workflow, plan_file)
│   └── status.ts             # Status schema (turn, current_task, completed_tasks)
├── utils/
│   └── errors.ts             # Custom error classes
└── index.ts                  # Public API exports

tests/
├── unit/
│   ├── state-machine.test.ts
│   ├── prompt-builder.test.ts
│   ├── output-parser.test.ts
│   └── providers.test.ts
└── integration/
    └── orchestrator.test.ts
```

---

## 12. Summary

Anvil is a Node.js-based orchestrator that coordinates generic workers (defined by config, not code) in a turn-based loop, using a shared state file and pure JSON worker output to iteratively implement and review tasks from a plan file.

**Key Properties:**
- Generic worker architecture — add workers by config, not code
- Turn-based orchestration with configurable workflow
- Pure JSON worker output — no heuristic parsing
- Shared state file as the single communication channel
- Commits happen after reviewer approves
- Local execution, fully inspectable and restartable
