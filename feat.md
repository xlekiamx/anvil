Project: Local Multi-Agent Orchestration with Generic Workers

1. Goal / What We Want

We want to build a local, deterministic, multi-agent system that coordinates generic workers in a turn-based loop with minimal human intervention.

The system should:
	•	Work locally (no GitHub Actions, no CI dependency)
	•	Support multiple repositories in parallel, without cross-repo pollution
	•	Use configurable workers with clear role separation
	•	Loop automatically:
    Code → Review → Fix → Review → … → Done
	•	Stop safely when:
	•	A task is approved
	•	A maximum iteration limit is reached
	•	Human intervention is explicitly required

This is not a chatbot and not a fully autonomous AI.
It is a controlled orchestration system where LLMs act as tools.

⸻

2. High-Level Architecture

Components
	•	Workers — Generic agents defined by config (provider + role + output_schema)
	  •	Receive a prompt, return JSON output
	  •	Never decide workflow — just execute and report
	•	Orchestrator — Dumb state machine (non-LLM)
	  •	Calls workers based on `turn` from state file
	  •	Parses JSON output, updates shared state
	  •	Handles commits after reviewer approves

Default Workers
	•	Coder (Claude Code CLI) — Implements tasks from the plan
	•	Reviewer (Codex CLI) — Reviews changes for correctness and quality

Communication Model
	•	No worker-to-worker direct communication
	•	Workers receive state context via prompt (built by orchestrator)
	•	Orchestrator owns the state file — workers never write to it
	•	Worker output is pure JSON

⸻

3. Core Design Principles

	1.	Workers are dumb
	  •	Each worker receives a prompt and returns JSON
	  •	Workers don't know about workflow, state, or other workers
	2.	Orchestrator is a dumb state machine
	  •	Reads state.json, determines whose turn it is
	  •	Builds prompt with role + plan + state + output schema
	  •	Calls worker, parses JSON output, updates state
	3.	Externalized State
	  •	All workflow state lives in state.json (not in LLM memory)
	  •	Deterministic, inspectable, restartable at any point
	4.	Pure JSON Output
	  •	Workers return structured JSON matching their output_schema
	  •	No heuristic parsing, no markdown extraction
	5.	Config-driven workers
	  •	Workers defined by provider + role + output_schema in config.json
	  •	Add new workers by editing config, not code
	6.	One Repo = One Isolated Loop
	  •	No shared memory, no cross-pollution
	  •	Parallel execution is safe by design

⸻

4. Data Model

config.json (per-repo, user-managed)
	•	`workers` map — keyed by role name (e.g., "coder", "reviewer")
	  •	Each worker: provider, role, model?, interactive?, output_schema
	•	`plan_file` — path to the plan file (e.g., "./PLAN.md")
	•	`workflow` — array of worker names defining turn order
	•	`loop_mode` — "auto" (continuous) or "manual" (pause after each task)
	•	`max_iterations_per_task` — iteration cap per task

state.json (orchestrator-owned)
	•	`turn` — which worker runs next
	•	`current_task` — task being worked on (id, description, status)
	•	`completed_tasks` — array of finished tasks
	•	`review_issues` — issues from the last review
	•	`iteration` — current iteration count (resets per task)
	•	`done`, `human_required`, `blocked_reason`

⸻

5. Key Technical Decisions

✅ Language: Node.js
	•	Excellent for I/O-bound orchestration
	•	Clean subprocess handling
	•	Native JSON handling

✅ Architecture: Turn-based state machine
	•	More predictable than agent-supervisor models
	•	Easier to debug and restart
	•	Workflow defined by config, not code

✅ Worker output: Pure JSON
	•	Output schema included in every prompt
	•	Orchestrator validates output against schema
	•	No heuristic/regex parsing

⸻

6. Execution Phases

Phase 1 — Foundation (Complete)
	•	Project structure with .ai/ directory
	•	State machine with turn-based transitions
	•	Mock workers for testing
	•	CLI commands (init, start, status, stop, resume)
	•	60 passing tests

Phase 2 — Real Workers (Complete)
	•	Claude Code CLI worker (interactive + non-interactive)
	•	Codex CLI worker
	•	Generic prompt builder with output schema
	•	Pure JSON output parser with validation

Phase 3 — Future
	•	File watcher / daemon trigger modes
	•	Persistent logging
	•	Configurable human intervention rules
	•	Additional provider types

⸻

7. Summary

Anvil is a local, Node.js-based orchestrator that coordinates generic workers in a turn-based loop, using a shared state file and pure JSON output to iteratively implement and review tasks from a plan file, with minimal human intervention.
