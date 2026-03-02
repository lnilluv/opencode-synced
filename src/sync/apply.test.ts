import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { syncLocalToRepo, syncRepoToLocal } from './apply.js';
import type { SyncPlan } from './paths.js';
import { normalizePath } from './paths.js';

describe('syncRepoToLocal extra manifest repoPath validation', () => {
  it('rejects absolute repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: '/etc/passwd',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        configRoot: homeDir,
        homeDir,
        platform: 'linux',
      };

      await expect(syncRepoToLocal(plan, null)).rejects.toThrow(/absolute paths are not allowed/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: '../../etc/passwd',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        configRoot: homeDir,
        homeDir,
        platform: 'linux',
      };

      await expect(syncRepoToLocal(plan, null)).rejects.toThrow(/path escapes repository root/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('accepts safe relative repoPath values from manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-apply-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const localPath = path.join(homeDir, 'target.txt');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');
      const repoSourcePath = path.join(repoRoot, 'config', 'extra', 'safe.txt');

      await mkdir(path.dirname(manifestPath), { recursive: true });
      await mkdir(path.dirname(repoSourcePath), { recursive: true });
      await writeFile(repoSourcePath, 'safe-data\n', 'utf8');
      await writeFile(
        manifestPath,
        JSON.stringify(
          {
            entries: [
              {
                sourcePath: localPath,
                repoPath: 'config/extra/safe.txt',
                type: 'file',
              },
            ],
          },
          null,
          2
        ),
        'utf8'
      );

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(localPath, homeDir, 'linux')],
          manifestPath,
          entries: [],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        configRoot: homeDir,
        homeDir,
        platform: 'linux',
      };

      await syncRepoToLocal(plan, null);

      const output = await readFile(localPath, 'utf8');
      expect(output).toBe('safe-data\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createSymlinkPlan(paths: {
  localPath: string;
  repoPath: string;
  configRoot: string;
  repoRoot: string;
}): SyncPlan {
  return {
    items: [
      {
        localPath: paths.localPath,
        repoPath: paths.repoPath,
        type: 'dir',
        isSecret: false,
        isConfigFile: false,
      },
    ],
    extraSecrets: {
      allowlist: [],
      manifestPath: path.join(paths.repoRoot, 'secrets', 'extra-manifest.json'),
      entries: [],
    },
    extraConfigs: {
      allowlist: [],
      manifestPath: path.join(paths.repoRoot, 'config', 'extra-manifest.json'),
      entries: [],
    },
    repoRoot: paths.repoRoot,
    configRoot: paths.configRoot,
    homeDir: '/Users/test',
    platform: 'darwin',
  };
}

describe('symlink portability', () => {
  it('rewrites absolute opencode symlinks to relative in repo output', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-'));
    const localConfigRoot = path.join(tempDir, 'local-config');
    const localPlugins = path.join(localConfigRoot, 'plugins');
    const localSuperpowersFile = path.join(
      localConfigRoot,
      'superpowers',
      '.opencode',
      'plugins',
      'superpowers.js'
    );
    const repoRoot = path.join(tempDir, 'repo');
    const repoPlugins = path.join(repoRoot, 'config', 'plugins');

    try {
      await mkdir(path.dirname(localSuperpowersFile), { recursive: true });
      await mkdir(localPlugins, { recursive: true });
      await writeFile(localSuperpowersFile, 'export default {}\n', { mode: 0o644 });
      await symlink(
        '/home/pryda/.config/opencode/superpowers/.opencode/plugins/superpowers.js',
        path.join(localPlugins, 'superpowers.js')
      );

      const plan = createSymlinkPlan({
        localPath: localPlugins,
        repoPath: repoPlugins,
        configRoot: localConfigRoot,
        repoRoot,
      });

      await syncLocalToRepo(plan, null);

      const repoLinkPath = path.join(repoPlugins, 'superpowers.js');
      const repoStat = await lstat(repoLinkPath);
      expect(repoStat.isSymbolicLink()).toBe(true);
      expect(await readlink(repoLinkPath)).toBe('../superpowers/.opencode/plugins/superpowers.js');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rewrites absolute opencode symlinks from repo to local config root', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-'));
    const localConfigRoot = path.join(tempDir, 'local-config');
    const localPlugins = path.join(localConfigRoot, 'plugins');
    const repoRoot = path.join(tempDir, 'repo');
    const repoPlugins = path.join(repoRoot, 'config', 'plugins');
    const repoSuperpowersFile = path.join(
      repoRoot,
      'config',
      'superpowers',
      '.opencode',
      'plugins',
      'superpowers.js'
    );

    try {
      await mkdir(path.dirname(repoSuperpowersFile), { recursive: true });
      await mkdir(repoPlugins, { recursive: true });
      await writeFile(repoSuperpowersFile, 'export default {}\n', { mode: 0o644 });
      await symlink(
        '/home/pryda/.config/opencode/superpowers/.opencode/plugins/superpowers.js',
        path.join(repoPlugins, 'superpowers.js')
      );

      const plan = createSymlinkPlan({
        localPath: localPlugins,
        repoPath: repoPlugins,
        configRoot: localConfigRoot,
        repoRoot,
      });

      await syncRepoToLocal(plan, null);

      const localLinkPath = path.join(localPlugins, 'superpowers.js');
      const localStat = await lstat(localLinkPath);
      expect(localStat.isSymbolicLink()).toBe(true);
      expect(await readlink(localLinkPath)).toBe('../superpowers/.opencode/plugins/superpowers.js');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
