import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { GlobalConfigManager } from '../../src/files/global-config.js';
import { ConfigSchema } from '../../src/types/config.js';

describe('GlobalConfigManager', () => {
  let tmpDir: string;
  let manager: GlobalConfigManager;

  const validConfig = ConfigSchema.parse({
    workers: {
      worker1: { provider: 'mock', role: 'test role', behavior: 'executor' },
    },
    workflow: ['worker1'],
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-global-'));
    manager = new GlobalConfigManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('directories', () => {
    it('getConfigsDir returns <base>/configs/', () => {
      expect(manager.getConfigsDir()).toBe(path.join(tmpDir, 'configs'));
    });

    it('getPromptsDir returns <base>/prompts/', () => {
      expect(manager.getPromptsDir()).toBe(path.join(tmpDir, 'prompts'));
    });
  });

  describe('exists', () => {
    it('returns false when config does not exist', async () => {
      expect(await manager.exists('myconfig')).toBe(false);
    });

    it('returns true when config exists', async () => {
      await manager.write('myconfig', validConfig);
      expect(await manager.exists('myconfig')).toBe(true);
    });
  });

  describe('write and read', () => {
    it('write creates directory and writes JSON', async () => {
      await manager.write('myconfig', validConfig);
      const filePath = path.join(tmpDir, 'configs', 'myconfig.json');
      const content = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(validConfig);
    });

    it('read returns valid Config', async () => {
      await manager.write('myconfig', validConfig);
      const config = await manager.read('myconfig');
      expect(config).toEqual(validConfig);
    });

    it('read throws when config does not exist', async () => {
      await expect(manager.read('missing')).rejects.toThrow();
    });
  });

  describe('list', () => {
    it('returns empty array when no configs', async () => {
      expect(await manager.list()).toEqual([]);
    });

    it('returns config names without .json', async () => {
      await manager.write('alpha', validConfig);
      await manager.write('beta', validConfig);
      const names = await manager.list();
      expect(names.sort()).toEqual(['alpha', 'beta']);
    });
  });

  describe('remove', () => {
    it('deletes an existing config', async () => {
      await manager.write('myconfig', validConfig);
      await manager.remove('myconfig');
      expect(await manager.exists('myconfig')).toBe(false);
    });

    it('no-ops when config does not exist', async () => {
      await expect(manager.remove('missing')).resolves.toBeUndefined();
    });
  });

  describe('ensurePrompts', () => {
    it('writes prompt files that do not exist', async () => {
      await manager.ensurePrompts({ 'planner': 'Plan content', 'reviewer': 'Review content' });
      const plannerPath = path.join(tmpDir, 'prompts', 'planner.md');
      const reviewerPath = path.join(tmpDir, 'prompts', 'reviewer.md');
      expect(await fs.readFile(plannerPath, 'utf-8')).toBe('Plan content');
      expect(await fs.readFile(reviewerPath, 'utf-8')).toBe('Review content');
    });

    it('does not overwrite existing prompt files', async () => {
      const promptsDir = path.join(tmpDir, 'prompts');
      await fs.mkdir(promptsDir, { recursive: true });
      await fs.writeFile(path.join(promptsDir, 'planner.md'), 'existing', 'utf-8');

      await manager.ensurePrompts({ 'planner': 'new content' });
      expect(await fs.readFile(path.join(promptsDir, 'planner.md'), 'utf-8')).toBe('existing');
    });
  });
});
