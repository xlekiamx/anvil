import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createAnvilContext } from '../../src/core/factory.js';
import { getDefaultConfig } from '../../src/types/config.js';
import { createLogger } from '../../src/logger/index.js';
import { resumeSession } from '../../src/cli/commands/resume.js';

async function createTestRepo(): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-resume-'));
  return {
    path: dir,
    cleanup: async () => { await fs.rm(dir, { recursive: true, force: true }); },
  };
}

describe('resumeSession human alignment', () => {
  let testRepo: { path: string; cleanup: () => Promise<void> };

  beforeEach(async () => { testRepo = await createTestRepo(); });
  afterEach(async () => { await testRepo.cleanup(); });

  it('stores human guidance in notes when human_required', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    await context.aiDir.create();
    await context.configFile.write(config);
    await context.statusFile.initialize(config.plan_file, config.workflow[0]!);
    await context.statusFile.update({
      human_required: true,
      current_task: { id: '1', status: 'in_review' },
      feedback: [{ description: 'SQL injection found', severity: 'critical' }],
    });

    await resumeSession(context, config, {
      guidancePromptFn: async () => 'Skip security checks, focus on the logic instead',
    });

    const status = await context.statusFile.read();
    expect(status!.notes).toContain('Human guidance: Skip security checks, focus on the logic instead');
    expect(status!.human_required).toBe(false);
    expect(status!.turn).toBe(config.workflow[0]);
    expect(status!.current_task?.status).toBe('fixing');
  });

  it('does not add to notes when user provides empty guidance', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    await context.aiDir.create();
    await context.configFile.write(config);
    await context.statusFile.initialize(config.plan_file, config.workflow[0]!);
    await context.statusFile.update({
      human_required: true,
      current_task: { id: '1', status: 'in_review' },
    });

    await resumeSession(context, config, {
      guidancePromptFn: async () => '',
    });

    const status = await context.statusFile.read();
    expect(status!.notes).toEqual([]);
    expect(status!.human_required).toBe(false);
  });

  it('accumulates notes with existing notes', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    await context.aiDir.create();
    await context.configFile.write(config);
    await context.statusFile.initialize(config.plan_file, config.workflow[0]!);
    await context.statusFile.update({
      human_required: true,
      notes: ['Prior decision note'],
    });

    await resumeSession(context, config, {
      guidancePromptFn: async () => 'Use repository pattern',
    });

    const status = await context.statusFile.read();
    expect(status!.notes).toContain('Prior decision note');
    expect(status!.notes).toContain('Human guidance: Use repository pattern');
  });

  it('clears blocked_reason without prompting for guidance', async () => {
    const context = createAnvilContext(testRepo.path, createLogger({ level: 'silent' }));
    const config = getDefaultConfig();

    await context.aiDir.create();
    await context.configFile.write(config);
    await context.statusFile.initialize(config.plan_file, config.workflow[0]!);
    await context.statusFile.update({ blocked_reason: 'Manual stop' });

    let promptCalled = false;
    await resumeSession(context, config, {
      guidancePromptFn: async () => { promptCalled = true; return ''; },
    });

    const status = await context.statusFile.read();
    expect(status!.blocked_reason).toBeNull();
    expect(promptCalled).toBe(false); // guidance not prompted for plain blocks
  });
});
