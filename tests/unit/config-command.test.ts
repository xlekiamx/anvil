import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { GlobalConfigManager } from '../../src/files/global-config.js';
import { ConfigSchema } from '../../src/types/config.js';
import {
  listConfigs,
  addConfig,
  removeConfig,
} from '../../src/cli/commands/config.js';

describe('config command functions', () => {
  let tmpDir: string;
  let manager: GlobalConfigManager;

  const validConfig = ConfigSchema.parse({
    workers: {
      worker1: { provider: 'mock', role: 'test', behavior: 'executor' },
    },
    workflow: ['worker1'],
  });

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-cmd-'));
    manager = new GlobalConfigManager(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('listConfigs', () => {
    it('returns empty array when no configs', async () => {
      const names = await listConfigs(manager);
      expect(names).toEqual([]);
    });

    it('shows config names', async () => {
      await manager.write('alpha', validConfig);
      await manager.write('beta', validConfig);
      const names = await listConfigs(manager);
      expect(names.sort()).toEqual(['alpha', 'beta']);
    });
  });

  describe('addConfig', () => {
    it('copies and validates config from path', async () => {
      const srcPath = path.join(tmpDir, 'source.json');
      await fs.writeFile(srcPath, JSON.stringify(validConfig), 'utf-8');

      await addConfig(manager, 'myconfig', srcPath);
      expect(await manager.exists('myconfig')).toBe(true);
      const stored = await manager.read('myconfig');
      expect(stored.workflow).toEqual(['worker1']);
    });

    it('rejects invalid config file', async () => {
      const srcPath = path.join(tmpDir, 'bad.json');
      await fs.writeFile(srcPath, '{ not valid json', 'utf-8');

      await expect(addConfig(manager, 'bad', srcPath)).rejects.toThrow();
    });
  });

  describe('removeConfig', () => {
    it('deletes an existing config', async () => {
      await manager.write('myconfig', validConfig);
      await removeConfig(manager, 'myconfig');
      expect(await manager.exists('myconfig')).toBe(false);
    });
  });
});
