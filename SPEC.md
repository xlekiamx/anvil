# Anvil - Local Multi-Agent Dev/Review Orchestration

## 1. Overview

Anvil is a local, deterministic, multi-agent orchestration system that continuously loops between code development and code review with minimal human intervention.

### Core Principles

- **Local-first**: No GitHub Actions, no CI dependency
- **Deterministic**: State-driven, inspectable, restartable at any point
- **Multi-repo safe**: One repo = one isolated loop, no cross-pollution
- **Controlled orchestration**: LLMs act as tools, not autonomous agents

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
| **Orchestrator** | Controller - owns state machine, decides agent execution | Node.js (non-LLM) |
| **Developer Agent** | Writes/modifies code, fixes issues | Claude Code CLI |
| **Reviewer Agent** | Reviews diffs, reports issues or approves | OpenAI Codex |

### 2.2 Responsibility Boundaries

**Orchestrator (Controller)**
- Load and save state files
- Decide which agent to invoke next
- Invoke agents and wait for process exit
- Read agent output files
- Enforce iteration limits and stop conditions
- **Does NOT** reason about code quality

**Developer Agent (Claude Code CLI)**
- Write and modify code
- Fix issues reported by reviewer
- Read review feedback from `.ai/review-output.json`
- **Does NOT** decide workflow or quality

**Reviewer Agent (Codex)**
- Review code changes (via git)
- Report remaining issues or approve
- Write structured output to `.ai/review-output.json`
- **Does NOT** write code

### 2.3 Communication Model

- **No agent-to-agent direct communication**
- Agents communicate indirectly via:
  - Repository file changes
  - Structured output files
  - Shared state file
- Orchestrator reads agent output files after process exit (no polling)

---

## 3. File Structure

Each repository contains its own AI control directory:

```
.ai/
├── config.json          # Per-repo configuration
├── status.json          # Workflow state (orchestrator-owned)
├── SPEC.md              # Feature requirements
└── review-output.json   # Reviewer decisions
```

### 3.0 File Ownership

| File | Write | Read |
|------|-------|------|
| `status.json` | Orchestrator (state), Developer (annotations only) | Orchestrator, Developer |
| `config.json` | User (manual) | Orchestrator |
| `SPEC.md` | User / CLI | Developer, Reviewer |
| `review-output.json` | Reviewer | Orchestrator, Developer |

**Key Rule:** Only the orchestrator may modify state fields in `status.json` (`status`, `iteration`, `human_required`, `done`). Developer may only add notes to the `annotations` field.

### 3.1 status.json (State File)

Single source of truth for workflow state.

- **State fields** (orchestrator-owned): `status`, `iteration`, `last_actor`, `human_required`, `done`
- **Annotations field** (developer may write): `annotations`

```json
{
  "feature_id": "auth-rate-limiting",
  "status": "needs_fix",
  "iteration": 2,
  "last_actor": "reviewer",
  "human_required": false,
  "done": false,
  "annotations": "Refactored rate limiter to use sliding window algorithm"
}
```

**Valid Statuses:**
| Status | Description |
|--------|-------------|
| `needs_fix` | Developer must address issues |
| `needs_review` | Reviewer must evaluate changes |
| `done` | Feature approved and complete |
| `blocked` | Requires human intervention or error recovery |

### 3.2 review-output.json (Reviewer Output)

Written by reviewer agent after each review cycle. Read by orchestrator and developer agent.

```json
{
  "approved": false,
  "issues": [
    {
      "id": "R1",
      "severity": "high",
      "category": "security",
      "description": "Rate limiter is not concurrency-safe",
      "file": "src/middleware/rateLimiter.ts",
      "line": 42
    }
  ],
  "summary": "Found 1 high-severity concurrency issue",
  "confidence": 0.85,
  "request_human": false
}
```

**Note:** `request_human` is a REQUEST from the reviewer. The orchestrator decides whether to honor it and records `human_required: true` in `status.json`.

**Issue Severity Levels:**
- `critical` - Security vulnerabilities, data loss risks
- `high` - Bugs, logic errors
- `medium` - Code quality, performance
- `low` - Style, minor improvements

**Issue Categories:**
- `security` - Security vulnerabilities
- `correctness` - Logic/functional bugs
- `performance` - Performance issues
- `maintainability` - Code quality, readability
- `architecture` - Design/structural concerns

### 3.3 SPEC.md (Feature Specification)

Markdown file containing feature requirements. Written by user or passed via CLI.

```markdown
# Feature: Auth Rate Limiting

## Requirements
- Implement rate limiting for authentication endpoints
- Limit: 5 attempts per minute per IP
- Return 429 status when limit exceeded

## Acceptance Criteria
- [ ] Rate limiter middleware created
- [ ] Applied to /login and /register endpoints
- [ ] Unit tests pass
- [ ] Integration tests pass
```

### 3.4 config.json (Per-Repo Configuration)

```json
{
  "max_iterations": 6,
  "trigger": {
    "mode": "manual",
    "watch_paths": [".ai/SPEC.md"],
    "interval_seconds": 300
  },
  "tests": {
    "enabled": true,
    "command": "npm test",
    "required_to_pass": false
  },
  "human_required_on": {
    "security_issues": true,
    "low_confidence_threshold": 0.6,
    "categories": ["security", "architecture"]
  }
}
```

---

## 4. State Machine

### 4.1 Loop Flow

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│   │  START   │────▶│ DEVELOP  │────▶│  REVIEW  │           │
│   └──────────┘     └──────────┘     └──────────┘           │
│                          ▲               │                  │
│                          │               │                  │
│                          │    ┌──────────▼──────────┐      │
│                          │    │    approved?        │      │
│                          │    └──────────┬──────────┘      │
│                          │               │                  │
│                    NO    │               │ YES              │
│                    ┌─────┴─────┐   ┌─────▼─────┐           │
│                    │ needs_fix │   │   DONE    │           │
│                    └───────────┘   └───────────┘           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 State Transitions

| From | To | Trigger |
|------|-----|---------|
| `(init)` | `needs_fix` | `anvil start` with new feature |
| `needs_fix` | `needs_review` | Developer agent exits |
| `needs_review` | `needs_fix` | Reviewer reports issues |
| `needs_review` | `done` | Reviewer approves |
| `*` | `blocked` | Human required / max iterations / error |

### 4.3 Stop Conditions

The loop terminates when:
1. **Feature approved**: `status = done`
2. **Max iterations reached**: `iteration >= max_iterations`
3. **Human required**: `human_required = true`
4. **Blocked**: Agent failure after retries

---

## 5. CLI Interface

### 5.1 Commands

```bash
# Initialize a repo for Anvil
anvil init

# Start the dev/review loop
anvil start                          # Uses .ai/SPEC.md
anvil start "Add user authentication" # Inline feature description

# Check current status
anvil status

# Stop the running loop
anvil stop

# Watch mode (file watcher trigger)
anvil watch

# Timer mode
anvil daemon --interval 300
```

### 5.2 Command Details

**`anvil init`**
- Creates `.ai/` directory
- Generates template `config.json`
- Creates empty `status.json`
- Creates template `SPEC.md`

**`anvil start [feature]`**
- If feature provided: writes to `.ai/SPEC.md`
- If `.ai/SPEC.md` exists: uses existing spec
- Initializes `status.json` with `needs_fix`
- Begins orchestration loop

**`anvil status`**
- Displays current `status.json` contents
- Shows iteration count
- Shows last actor
- Shows any pending issues

**`anvil stop`**
- Gracefully stops running loop
- Sets `status = blocked` with reason
- Preserves current state for resume

**`anvil watch`**
- Watches configured paths for changes
- Auto-triggers on file modifications

**`anvil daemon`**
- Runs on timer interval
- Background process mode

---

## 6. Agent Invocation

### 6.1 Developer Agent (Claude Code CLI)

**Invocation:**
```bash
claude --dangerously-skip-permissions \
  --print \
  --output-format json \
  "Read .ai/SPEC.md for requirements and .ai/review-output.json for issues to fix. Implement the required changes."
```

**Agent Responsibilities:**
1. Read `.ai/SPEC.md` for feature requirements
2. Read `.ai/review-output.json` for issues (if exists)
3. Make code changes
4. Agent handles git operations internally
5. Exit when work complete

**Output:**
- Code changes committed to repo
- Optional: annotations in `status.json.annotations`
- Process exit signals completion to orchestrator

### 6.2 Reviewer Agent (Codex)

**Invocation:**
```bash
# Orchestrator prepares context and invokes Codex API/CLI
# Reviewer receives:
# - Feature spec from .ai/SPEC.md
# - Access to git diff
# - Previous review history (if any)
```

**Agent Responsibilities:**
1. Read `.ai/SPEC.md` for requirements
2. Analyze changes (via git diff)
3. Evaluate against acceptance criteria
4. Write structured output to `.ai/review-output.json`

**Output:**
- `.ai/review-output.json` with approval status, issues, confidence

---

## 7. Human Intervention

### 7.1 Request vs Enforcement

- **Agents REQUEST** human intervention via their output files (`request_human: true`)
- **Orchestrator DECIDES** whether to honor the request based on config rules
- **Orchestrator RECORDS** the decision in `status.json` (`human_required: true`)
- **Orchestrator ENFORCES** the stop by halting the loop

### 7.2 Triggers

The orchestrator sets `human_required: true` when:

1. **Agent Request**: Reviewer sets `request_human: true` in output

2. **Security/Critical Issues**: Reviewer reports issues with `category: "security"` or `severity: "critical"`

3. **Low Confidence**: Reviewer's `confidence` score falls below threshold (default: 0.6)

4. **Specific Categories**: Issues match categories configured in `config.json` (default: `security`, `architecture`)

### 7.3 Resolution Flow

1. Orchestrator sets `status = blocked`, `human_required = true`
2. Human reviews `.ai/review-output.json` and code
3. Human either:
   - Fixes issues manually and runs `anvil start --resume`
   - Adjusts SPEC.md and runs `anvil start --resume`
   - Marks as complete: `anvil complete`

---

## 8. Error Handling

### 8.1 Agent Failures

When an agent process fails:

1. **First failure**: Log error, retry immediately
2. **Second failure**: Log error, retry with 5s delay
3. **Third failure**: Log error, retry with 30s delay
4. **Fourth failure**: Set `status = blocked`, require human intervention

### 8.2 Recoverable Errors

- Network timeouts
- Rate limiting (auto-retry with backoff)
- Temporary API unavailability

### 8.3 Non-Recoverable Errors

- Invalid API credentials
- Repository corruption
- Missing required files

---

## 9. Logging

### 9.1 Log Levels

**Standard (default):**
- State transitions
- Agent invocations
- Iteration counts
- Errors and warnings

**Output Format:**
```
[2024-01-15 10:30:45] [INFO] Starting iteration 3
[2024-01-15 10:30:45] [INFO] Invoking developer agent
[2024-01-15 10:32:12] [INFO] Developer agent completed
[2024-01-15 10:32:12] [INFO] Status: needs_fix → needs_review
[2024-01-15 10:32:13] [INFO] Invoking reviewer agent
[2024-01-15 10:33:45] [INFO] Reviewer agent completed
[2024-01-15 10:33:45] [INFO] Found 2 issues (1 high, 1 medium)
[2024-01-15 10:33:45] [INFO] Status: needs_review → needs_fix
```

### 9.2 Log Location

- Console output (stdout/stderr)
- Optional: `.ai/logs/` directory for persistent logs

---

## 10. Execution Phases

### Phase 1 - Foundation (No LLMs)

- [ ] Create project structure with `.ai/` directory
- [ ] Implement Node.js orchestrator loop
- [ ] Mock developer/reviewer agents (echo + sleep)
- [ ] Validate state transitions
- [ ] Validate stop conditions
- [ ] Validate iteration limits
- [ ] Implement CLI commands (`init`, `start`, `status`, `stop`)

### Phase 2 - Real Agents

- [ ] Integrate Claude Code CLI as developer
- [ ] Integrate Codex as reviewer
- [ ] Enforce structured JSON outputs
- [ ] Implement retry logic with backoff
- [ ] End-to-end test with real feature

### Phase 3 - Trigger Modes

- [ ] File watcher implementation
- [ ] Timer/daemon mode
- [ ] Graceful shutdown handling

### Phase 4 - Hardening (Optional)

- [ ] Persistent logging to files
- [ ] Human intervention hooks
- [ ] Test gate before review
- [ ] Configurable log levels
- [ ] Metrics and timing data

---

## 11. Technical Requirements

### 11.1 Runtime

- Node.js 18+ (LTS)
- npm or yarn

### 11.2 External Dependencies

- Claude Code CLI (installed and configured)
- OpenAI API access for Codex (configured)
- Git (for diff analysis)

### 11.3 File Permissions

- Read/write access to `.ai/` directory
- Execute permission for agent CLIs

---

## 12. Example Session

```bash
# Initialize project
$ anvil init
Created .ai/config.json
Created .ai/status.json
Created .ai/SPEC.md (template)

# Define feature
$ anvil start "Add rate limiting to auth endpoints - 5 attempts/min/IP"
[INFO] Feature written to .ai/SPEC.md
[INFO] Starting iteration 1
[INFO] Invoking developer agent...
[INFO] Developer agent completed (47s)
[INFO] Status: needs_fix → needs_review
[INFO] Invoking reviewer agent...
[INFO] Reviewer agent completed (12s)
[INFO] Found 2 issues (1 high, 1 medium)
[INFO] Status: needs_review → needs_fix
[INFO] Starting iteration 2
[INFO] Invoking developer agent...
[INFO] Developer agent completed (31s)
[INFO] Status: needs_fix → needs_review
[INFO] Invoking reviewer agent...
[INFO] Reviewer agent completed (10s)
[INFO] Feature approved!
[INFO] Status: needs_review → done
[SUCCESS] Feature "auth-rate-limiting" completed in 2 iterations

# Check final status
$ anvil status
Feature: auth-rate-limiting
Status: done
Iterations: 2
Last Actor: reviewer
```

---

## 13. Summary

Anvil is a Node.js-based orchestrator that coordinates Claude Code (developer) and Codex (reviewer) in a deterministic loop, using explicit state files instead of LLM memory, to iteratively develop and review code with minimal human intervention.

**Key Properties:**
- Local execution, no cloud CI dependency
- State-driven, fully inspectable and restartable
- Multi-provider LLM architecture
- Safe parallel execution across repos
- Clear role separation between agents
