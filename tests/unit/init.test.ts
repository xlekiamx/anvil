import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { initProject } from '../../src/cli/commands/init.js';
import { GlobalConfigManager } from '../../src/files/global-config.js';
import { ConfigSchema } from '../../src/types/config.js';

describe('initProject', () => {
  let tmpDir: string;
  let globalDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-init-'));
    globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-global-init-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    await fs.rm(globalDir, { recursive: true, force: true });
  });

  it('default init creates .ai dir and config', async () => {
    await initProject({ path: tmpDir });
    const configPath = path.join(tmpDir, '.ai', 'config.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = ConfigSchema.parse(JSON.parse(content));
    expect(config.workers.coder).toBeDefined();
    expect(config.workers.reviewer).toBeDefined();
  });

  it('default init creates prompts directory', async () => {
    await initProject({ path: tmpDir });
    const coderPrompt = path.join(tmpDir, 'prompts', 'coder.md');
    const stat = await fs.stat(coderPrompt);
    expect(stat.isFile()).toBe(true);
  });

  it('--config planning creates local planning config', async () => {
    await initProject({ path: tmpDir, config: 'planning' });
    const configPath = path.join(tmpDir, '.ai', 'config.planning.json');
    const content = await fs.readFile(configPath, 'utf-8');
    const config = ConfigSchema.parse(JSON.parse(content));
    expect(config.workers.planner).toBeDefined();
    expect(config.workers['plan-reviewer']).toBeDefined();
    expect(config.workflow).toEqual(['planner', 'plan-reviewer']);
  });

  it('--config planning creates local prompt files', async () => {
    await initProject({ path: tmpDir, config: 'planning' });
    const plannerPrompt = path.join(tmpDir, 'prompts', 'planner.md');
    const stat = await fs.stat(plannerPrompt);
    expect(stat.isFile()).toBe(true);
  });

  it('--global --config planning creates global config + prompts', async () => {
    const manager = new GlobalConfigManager(globalDir);
    await initProject({ path: tmpDir, config: 'planning', global: true, globalManager: manager });

    expect(await manager.exists('planning')).toBe(true);
    const config = await manager.read('planning');
    expect(config.workers.planner).toBeDefined();

    const promptPath = path.join(globalDir, 'prompts', 'planner.md');
    const stat = await fs.stat(promptPath);
    expect(stat.isFile()).toBe(true);
  });
});
