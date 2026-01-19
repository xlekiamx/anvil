Project: Local Multi-Agent Dev ↔ Review Orchestration

1. Goal / What We Want

We want to build a local, deterministic, multi-agent system that continuously loops between code development and code review with minimal human intervention.

The system should:
	•	Work locally (no GitHub Actions, no CI dependency)
	•	Support multiple repositories in parallel, without cross-repo pollution
	•	Use multiple LLM providers with clear role separation
	•	Loop automatically:
    Develop → Review → Fix → Review → … → Done
	•	Stop safely when:
	•	The feature is approved
	•	A maximum iteration limit is reached
	•	Human intervention is explicitly required

This is not a chatbot and not a fully autonomous AI.
It is a controlled orchestration system where LLMs act as tools.

⸻

2. High-Level Architecture

Roles
	•	Claude Code → Developer
	•	Writes and modifies code
	•	Fixes issues reported by the reviewer
	•	Does NOT decide workflow or quality
	•	Codex → Reviewer / Planner
	•	Reviews diffs and tests
	•	Reports remaining issues or approves
	•	Does NOT write code
	•	Orchestrator → Controller (non-LLM)
	•	Owns the state machine
	•	Decides which agent runs next
	•	Enforces iteration limits and stop conditions
	•	Injects context and parses structured outputs

3. Core Design Principles
	1.	Stateless LLM Calls
	•	Every agent invocation starts with a fresh context window
	•	Continuity is achieved via external state, not chat memory
	2.	Externalized State
	•	All workflow state lives in files (not in LLM memory)
	•	Deterministic, inspectable, restartable at any point
	3.	No Agent-to-Agent Direct Chat
	•	Agents “communicate” indirectly via:
	•	Repo changes
	•	Structured outputs
	•	Shared state file
	4.	One Repo = One Isolated Loop
	•	No shared memory, no cross-pollution
	•	Parallel execution is safe by design

⸻

4. Minimal State Model (Per Repo)

Each repository contains its own AI control directory:
.ai/
  ├── state.json
  ├── context.md

state.json (single source of truth)
{
  "feature_id": "auth-rate-limiting",
  "status": "needs_fix",
  "iteration": 2,
  "max_iterations": 6,
  "issues": [
    {
      "id": "R1",
      "severity": "high",
      "description": "Rate limiter is not concurrency-safe"
    }
  ],
  "last_actor": "reviewer",
  "human_required": false,
  "done": false
}

Valid statuses:
	•	needs_fix
	•	needs_review
	•	done
	•	blocked

⸻

5. Orchestrator (What It Is)

The orchestrator is the central component.

It is:
	•	A small Node.js program
	•	Deterministic
	•	Non-LLM
	•	The only component allowed to mutate workflow state

Responsibilities
	•	Load and save .ai/state.json
	•	Decide which agent to invoke next
	•	Invoke:
	•	Claude Code CLI (developer)
	•	Codex API (reviewer)
	•	Validate agent outputs
	•	Enforce:
	•	Max iterations
	•	Human-required stops
	•	Run on a timer or manual trigger

Important:
The orchestrator does no reasoning about code quality.
All judgment lives in the reviewer agent.

⸻

6. Key Technical Decisions (Final)

✅ Language Choice

Node.js was chosen for the orchestrator because:
	•	Excellent for I/O-bound orchestration
	•	Clean subprocess handling (Claude Code CLI)
	•	Native JSON handling
	•	Simple async scheduling
	•	Minimal runtime overhead
	•	Deterministic single-threaded execution

Python and Elixir were considered, but Node.js is the best fit for a first, stable implementation.

✅ Architecture Choice

We chose a state-driven orchestrator architecture, not an agent-supervisor model.

Why:
	•	More predictable
	•	Easier to debug
	•	Easier to restart
	•	Avoids “agent over-reasoning”
	•	Scales cleanly across repos

⸻

7. Execution Plan

Phase 1 — Foundation (No LLMs)
	•	Create repo layout with .ai/state.json
	•	Implement Node.js orchestrator loop
	•	Mock developer/reviewer agents
	•	Validate:
	•	State transitions
	•	Stop conditions
	•	Iteration limits

Phase 2 — Real Agents
	•	Integrate Claude Code as developer
	•	Integrate Codex as reviewer
	•	Enforce structured JSON outputs
	•	Keep prompts minimal and role-strict

Phase 3 — Parallel Repos
	•	Run one orchestrator instance per repo
	•	Add basic rate limiting
	•	Optional file locks on state.json

Phase 4 — Hardening (Optional)
	•	Logging & replay
	•	Human intervention hooks
	•	Test gate before review
	•	Promotion to long-running service if needed

⸻

8. What This System Is (and Is Not)

This system is:
	•	A local AI development assistant
	•	Deterministic and restartable
	•	Multi-provider by design
	•	Safe to run in parallel

This system is NOT:
	•	A chatbot
	•	A fully autonomous AI
	•	A CI replacement
	•	A magic code generator

⸻

9. One-Sentence Summary

We are building a local, Node.js-based orchestrator that coordinates Claude Code (developer) and Codex (reviewer) in a deterministic loop, using explicit state files instead of LLM memory, to iteratively develop and review code across multiple repositories without cross-pollution.


