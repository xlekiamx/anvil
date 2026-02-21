# Plan: Global Config Support

## Context

Anvil currently only loads configs from the project's `.ai/` directory. Users can't reuse configs across projects. As an installable CLI tool, anvil needs a global config directory (`~/.anvil/configs/`) where users store reusable workflow configs (e.g., "planning", "coding"). The `--config` flag should resolve local-first, then fall back to global. A built-in "planning" config (planner + plan-reviewer) ships as a default.

## Design

- **Global dir**: `~/.anvil/configs/` stores `<name>.json` files
- **Resolution order**: local `.ai/config.<name>.json` → global `~/.anvil/configs/<name>.json` → built-in
- **Prompt files for global configs**: `~/.anvil/prompts/` (alongside configs)
- **CLI commands**: `anvil config list|add|remove` for managing global configs
- **Init flags**: `anvil init --config <name> --global` creates in global dir

## Tasks

### Task 1: Built-in configs and prompt templates

Create `src/files/builtin-configs.ts` with a "planning" config:
- planner: executor, provider claude, prompt_file `~/.anvil/prompts/planner.md`
- plan-reviewer: reviewer, provider codex, prompt_file `~/.anvil/prompts/plan-reviewer.md`
- workflow: `['planner', 'plan-reviewer']`, plan_file `./PLAN.md`

Create `src/files/prompt-templates.ts` with prompt content for planner and plan-reviewer.

**Tests first** (`tests/unit/builtin-configs.test.ts`):
- `getBuiltinConfig('planning')` returns valid Config
- Planning config has planner (executor) + plan-reviewer (reviewer)
- Planning config passes ConfigSchema validation
- `getBuiltinConfig('nonexistent')` returns undefined
- `getBuiltinPrompt('planner')` / `getBuiltinPrompt('plan-reviewer')` return strings
- `getBuiltinPrompt('nonexistent')` returns undefined

**Files:** `src/files/builtin-configs.ts`, `src/files/prompt-templates.ts`, `tests/unit/builtin-configs.test.ts`

---

### Task 2: GlobalConfigManager class

Create `src/files/global-config.ts` — manages `~/.anvil/configs/`.

```
class GlobalConfigManager {
  getGlobalDir(): string           // ~/.anvil/configs/
  getPromptsDir(): string          // ~/.anvil/prompts/
  exists(name): Promise<boolean>
  read(name): Promise<Config>
  write(name, config): Promise<void>
  list(): Promise<string[]>
  remove(name): Promise<void>
  ensurePrompts(promptMap): Promise<void>  // write prompt files if missing
}
```

**Tests first** (`tests/unit/global-config.test.ts`):
- Uses temp dir (inject base path for testability)
- `exists()` false when missing, true when present
- `read()` returns valid Config
- `write()` creates dir + writes JSON
- `list()` returns config names (without .json)
- `remove()` deletes file, no-ops if missing

**Files:** `src/files/global-config.ts`, `tests/unit/global-config.test.ts`

---

### Task 3: Config resolution fallback in ConfigFile

Modify `ConfigFile` to accept optional `GlobalConfigManager`. Update `read()`:
1. Try local `.ai/config.<name>.json`
2. If not found and configName set → try `globalConfigManager.read(configName)`
3. If not found → try `getBuiltinConfig(configName)`
4. Fall back to `getDefaultConfig()`

Store `configName` as a field so it's available in `read()`.

**Tests first** (add to `tests/unit/config.test.ts`):
- Local config takes precedence over global
- Falls back to global when local missing
- Falls back to builtin when both missing
- Works without GlobalConfigManager (backwards compat)

**Files:** `src/files/config.ts`, `tests/unit/config.test.ts`

---

### Task 4: Update factory to wire GlobalConfigManager

Modify `createAnvilContext` to create `GlobalConfigManager` and pass it to `ConfigFile`.

**Files:** `src/core/factory.ts`

---

### Task 5: `anvil config` command (list/add/remove)

Create `src/cli/commands/config.ts` with subcommands:
- `anvil config list` — lists global configs (names from `~/.anvil/configs/`)
- `anvil config add <name> --from <path>` — copies a JSON file to global configs, validates it
- `anvil config remove <name>` — deletes a global config

Register in `src/cli/index.ts`.

**Tests first** (`tests/unit/config-command.test.ts`):
- `list` shows config names
- `add` copies and validates config
- `remove` deletes config

**Files:** `src/cli/commands/config.ts`, `src/cli/index.ts`, `tests/unit/config-command.test.ts`

---

### Task 6: Update init for --global and --config flags

Modify `src/cli/commands/init.ts`:
- `anvil init --config planning --global` → writes planning config to `~/.anvil/configs/planning.json` + prompts to `~/.anvil/prompts/`
- `anvil init --config planning` → uses builtin planning config as template, writes to local `.ai/config.planning.json` + local `prompts/`
- `anvil init` (no flags) → unchanged behavior

**Tests first** (add to existing tests or new `tests/unit/init.test.ts`):
- Default init unchanged
- `--config planning` creates local planning config
- `--global --config planning` creates global planning config + prompts

**Files:** `src/cli/commands/init.ts`

---

### Task 7: Update exports and cleanup

- Export new modules from `src/files/index.ts` and `src/index.ts`
- Update `templates/config.json` to match current schema (add behavior, prompt_file, done, completed_tasks)
- `npm run build` + all tests pass

**Files:** `src/files/index.ts`, `src/index.ts`, `templates/config.json`

## Verification

1. `npm run build` — zero errors
2. `npx vitest run` — all tests pass
3. Manual test: `anvil config list` shows no configs
4. Manual test: `anvil init --config planning --global` creates `~/.anvil/configs/planning.json`
5. Manual test: `anvil config list` shows "planning"
6. Manual test: In anvol project, `anvil start --config planning` resolves to global planning config
7. Manual test: `anvil config remove planning` deletes it
