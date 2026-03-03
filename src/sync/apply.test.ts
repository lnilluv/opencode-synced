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

function createCompatibilityPlan(paths: {
  configRoot: string;
  repoRoot: string;
  homeDir: string;
  platform?: NodeJS.Platform;
}): SyncPlan {
  const repoConfigRoot = path.join(paths.repoRoot, 'config');

  return {
    items: [
      {
        localPath: path.join(paths.configRoot, 'superpowers'),
        repoPath: path.join(repoConfigRoot, 'superpowers'),
        type: 'dir',
        isSecret: false,
        isConfigFile: false,
      },
      {
        localPath: path.join(paths.configRoot, 'skills'),
        repoPath: path.join(repoConfigRoot, 'skills'),
        type: 'dir',
        isSecret: false,
        isConfigFile: false,
      },
      {
        localPath: path.join(paths.configRoot, 'plugins'),
        repoPath: path.join(repoConfigRoot, 'plugins'),
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
    homeDir: paths.homeDir,
    platform: paths.platform ?? 'linux',
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

describe('cross-platform compatibility symlink repair', () => {
  it('creates missing superpowers skill and plugin links during repo-to-local sync', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-compat-'));
    try {
      const homeDir = path.join(tempDir, 'home');
      const configRoot = path.join(homeDir, '.config', 'opencode');
      const repoRoot = path.join(tempDir, 'repo');
      const repoConfigRoot = path.join(repoRoot, 'config');

      const repoSkillTarget = path.join(
        repoConfigRoot,
        'superpowers',
        'skills',
        'sample',
        'SKILL.md'
      );
      const repoPluginTarget = path.join(
        repoConfigRoot,
        'superpowers',
        '.opencode',
        'plugins',
        'superpowers.js'
      );

      await mkdir(path.dirname(repoSkillTarget), { recursive: true });
      await mkdir(path.dirname(repoPluginTarget), { recursive: true });
      await mkdir(path.join(repoConfigRoot, 'skills'), { recursive: true });
      await mkdir(path.join(repoConfigRoot, 'plugins'), { recursive: true });
      await writeFile(repoSkillTarget, '# sample\n', 'utf8');
      await writeFile(repoPluginTarget, 'export default {}\n', 'utf8');

      const plan = createCompatibilityPlan({
        configRoot,
        repoRoot,
        homeDir,
        platform: 'linux',
      });

      await syncRepoToLocal(plan, null);

      const localSkillLink = path.join(configRoot, 'skills', 'superpowers');
      const localPluginLink = path.join(configRoot, 'plugins', 'superpowers.js');

      expect((await lstat(localSkillLink)).isSymbolicLink()).toBe(true);
      expect((await lstat(localPluginLink)).isSymbolicLink()).toBe(true);
      expect(await readlink(localSkillLink)).toBe('../superpowers/skills');
      expect(await readlink(localPluginLink)).toBe(
        '../superpowers/.opencode/plugins/superpowers.js'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('creates missing superpowers skill and plugin links before local-to-repo sync', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-compat-'));
    try {
      const homeDir = path.join(tempDir, 'home');
      const configRoot = path.join(homeDir, '.config', 'opencode');
      const repoRoot = path.join(tempDir, 'repo');

      const localSkillTarget = path.join(configRoot, 'superpowers', 'skills', 'sample', 'SKILL.md');
      const localPluginTarget = path.join(
        configRoot,
        'superpowers',
        '.opencode',
        'plugins',
        'superpowers.js'
      );

      await mkdir(path.dirname(localSkillTarget), { recursive: true });
      await mkdir(path.dirname(localPluginTarget), { recursive: true });
      await mkdir(path.join(configRoot, 'skills'), { recursive: true });
      await mkdir(path.join(configRoot, 'plugins'), { recursive: true });
      await writeFile(localSkillTarget, '# sample\n', 'utf8');
      await writeFile(localPluginTarget, 'export default {}\n', 'utf8');

      const plan = createCompatibilityPlan({
        configRoot,
        repoRoot,
        homeDir,
        platform: 'linux',
      });

      await syncLocalToRepo(plan, null);

      const repoSkillLink = path.join(repoRoot, 'config', 'skills', 'superpowers');
      const repoPluginLink = path.join(repoRoot, 'config', 'plugins', 'superpowers.js');

      expect((await lstat(repoSkillLink)).isSymbolicLink()).toBe(true);
      expect((await lstat(repoPluginLink)).isSymbolicLink()).toBe(true);
      expect(await readlink(repoSkillLink)).toBe('../superpowers/skills');
      expect(await readlink(repoPluginLink)).toBe(
        '../superpowers/.opencode/plugins/superpowers.js'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('replaces non-symlink compatibility paths during repo-to-local sync', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-compat-'));
    try {
      const homeDir = path.join(tempDir, 'home');
      const configRoot = path.join(homeDir, '.config', 'opencode');
      const repoRoot = path.join(tempDir, 'repo');
      const repoConfigRoot = path.join(repoRoot, 'config');

      const repoSkillTarget = path.join(
        repoConfigRoot,
        'superpowers',
        'skills',
        'sample',
        'SKILL.md'
      );
      const repoPluginTarget = path.join(
        repoConfigRoot,
        'superpowers',
        '.opencode',
        'plugins',
        'superpowers.js'
      );
      const legacySkillPath = path.join(repoConfigRoot, 'skills', 'superpowers');
      const legacyPluginPath = path.join(repoConfigRoot, 'plugins', 'superpowers.js');

      await mkdir(path.dirname(repoSkillTarget), { recursive: true });
      await mkdir(path.dirname(repoPluginTarget), { recursive: true });
      await mkdir(legacySkillPath, { recursive: true });
      await mkdir(path.dirname(legacyPluginPath), { recursive: true });
      await writeFile(repoSkillTarget, '# sample\n', 'utf8');
      await writeFile(repoPluginTarget, 'export default {}\n', 'utf8');
      await writeFile(path.join(legacySkillPath, 'stale.txt'), 'stale\n', 'utf8');
      await writeFile(legacyPluginPath, 'stale\n', 'utf8');

      const plan = createCompatibilityPlan({
        configRoot,
        repoRoot,
        homeDir,
        platform: 'linux',
      });

      await syncRepoToLocal(plan, null);

      const localSkillLink = path.join(configRoot, 'skills', 'superpowers');
      const localPluginLink = path.join(configRoot, 'plugins', 'superpowers.js');

      expect((await lstat(localSkillLink)).isSymbolicLink()).toBe(true);
      expect((await lstat(localPluginLink)).isSymbolicLink()).toBe(true);
      expect(await readlink(localSkillLink)).toBe('../superpowers/skills');
      expect(await readlink(localPluginLink)).toBe(
        '../superpowers/.opencode/plugins/superpowers.js'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('replaces non-symlink compatibility paths during local-to-repo sync', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-compat-'));
    try {
      const homeDir = path.join(tempDir, 'home');
      const configRoot = path.join(homeDir, '.config', 'opencode');
      const repoRoot = path.join(tempDir, 'repo');

      const localSkillTarget = path.join(configRoot, 'superpowers', 'skills', 'sample', 'SKILL.md');
      const localPluginTarget = path.join(
        configRoot,
        'superpowers',
        '.opencode',
        'plugins',
        'superpowers.js'
      );
      const legacySkillPath = path.join(configRoot, 'skills', 'superpowers');
      const legacyPluginPath = path.join(configRoot, 'plugins', 'superpowers.js');

      await mkdir(path.dirname(localSkillTarget), { recursive: true });
      await mkdir(path.dirname(localPluginTarget), { recursive: true });
      await mkdir(legacySkillPath, { recursive: true });
      await mkdir(path.dirname(legacyPluginPath), { recursive: true });
      await writeFile(localSkillTarget, '# sample\n', 'utf8');
      await writeFile(localPluginTarget, 'export default {}\n', 'utf8');
      await writeFile(path.join(legacySkillPath, 'stale.txt'), 'stale\n', 'utf8');
      await writeFile(legacyPluginPath, 'stale\n', 'utf8');

      const plan = createCompatibilityPlan({
        configRoot,
        repoRoot,
        homeDir,
        platform: 'linux',
      });

      await syncLocalToRepo(plan, null);

      const repoSkillLink = path.join(repoRoot, 'config', 'skills', 'superpowers');
      const repoPluginLink = path.join(repoRoot, 'config', 'plugins', 'superpowers.js');

      expect((await lstat(repoSkillLink)).isSymbolicLink()).toBe(true);
      expect((await lstat(repoPluginLink)).isSymbolicLink()).toBe(true);
      expect(await readlink(repoSkillLink)).toBe('../superpowers/skills');
      expect(await readlink(repoPluginLink)).toBe(
        '../superpowers/.opencode/plugins/superpowers.js'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('writeExtraPathManifest', () => {
  it('handles home-relative source paths when syncing local extras to repo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-extra-'));
    try {
      const homeDir = path.join(root, 'home');
      const repoRoot = path.join(root, 'repo');
      const skillsDir = path.join(homeDir, '.config', 'opencode', 'skills');
      const skillFile = path.join(skillsDir, 'sample.txt');
      const encodedRepoPath = path.join(repoRoot, 'config', 'extra', 'skills-abc12345');
      const manifestPath = path.join(repoRoot, 'config', 'extra-manifest.json');

      await mkdir(skillsDir, { recursive: true });
      await writeFile(skillFile, 'sample\n', 'utf8');

      const plan: SyncPlan = {
        items: [],
        extraConfigs: {
          allowlist: [normalizePath(skillsDir, homeDir, 'linux')],
          manifestPath,
          entries: [
            {
              sourcePath: '~/.config/opencode/skills',
              repoPath: encodedRepoPath,
            },
          ],
        },
        extraSecrets: {
          allowlist: [],
          manifestPath: path.join(repoRoot, 'secrets', 'extra-manifest.json'),
          entries: [],
        },
        repoRoot,
        configRoot: path.join(homeDir, '.config', 'opencode'),
        homeDir,
        platform: 'linux',
      };

      await syncLocalToRepo(plan, null);

      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        entries: Array<{ sourcePath: string; repoPath: string }>;
      };
      expect(manifest.entries.length).toBe(1);
      expect(manifest.entries[0]?.sourcePath).toBe('~/.config/opencode/skills');
      expect(await readFile(path.join(encodedRepoPath, 'sample.txt'), 'utf8')).toBe('sample\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
