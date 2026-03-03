import { promises as fs } from 'node:fs';
import path from 'node:path';
import { chmodIfExists, deepMerge, hasOwn, parseJsonc, pathExists, stripOverrides, writeJsonFile, } from './config.js';
import { extractMcpSecrets, hasOverrides, mergeOverrides, stripOverrideKeys, } from './mcp-secrets.js';
import { expandHome, normalizePath } from './paths.js';
export async function syncRepoToLocal(plan, overrides) {
    for (const item of plan.items) {
        await copyItem(item.repoPath, item.localPath, item.type);
    }
    await rewriteAbsoluteOpencodeSymlinks(plan.configRoot, plan.configRoot);
    await applyExtraPaths(plan, plan.extraConfigs);
    await applyExtraPaths(plan, plan.extraSecrets);
    await ensureOpencodeCompatibilitySymlinks(plan.configRoot);
    if (overrides && Object.keys(overrides).length > 0) {
        await applyOverridesToLocalConfig(plan, overrides);
    }
}
export async function syncLocalToRepo(plan, overrides, options = {}) {
    const configItems = plan.items.filter((item) => item.isConfigFile);
    const sanitizedConfigs = new Map();
    let secretOverrides = {};
    const allowMcpSecrets = Boolean(options.allowMcpSecrets);
    await ensureOpencodeCompatibilitySymlinks(plan.configRoot);
    for (const item of configItems) {
        if (!(await pathExists(item.localPath)))
            continue;
        const content = await fs.readFile(item.localPath, 'utf8');
        const parsed = parseJsonc(content);
        const { sanitizedConfig, secretOverrides: extracted } = extractMcpSecrets(parsed);
        if (!allowMcpSecrets) {
            sanitizedConfigs.set(item.localPath, sanitizedConfig);
        }
        if (hasOverrides(extracted)) {
            secretOverrides = mergeOverrides(secretOverrides, extracted);
        }
    }
    let overridesForStrip = overrides;
    if (hasOverrides(secretOverrides)) {
        if (!allowMcpSecrets) {
            const baseOverrides = overrides ?? {};
            const mergedOverrides = mergeOverrides(baseOverrides, secretOverrides);
            if (options.overridesPath && !isDeepEqual(baseOverrides, mergedOverrides)) {
                await writeJsonFile(options.overridesPath, mergedOverrides, { jsonc: true });
            }
        }
        overridesForStrip = overrides ? stripOverrideKeys(overrides, secretOverrides) : overrides;
    }
    for (const item of plan.items) {
        if (item.isConfigFile) {
            const sanitized = sanitizedConfigs.get(item.localPath);
            await copyConfigForRepo(item, overridesForStrip, plan.repoRoot, sanitized);
            continue;
        }
        await copyItem(item.localPath, item.repoPath, item.type, true);
    }
    await rewriteAbsoluteOpencodeSymlinks(path.join(plan.repoRoot, 'config'), path.join(plan.repoRoot, 'config'));
    await writeExtraPathManifest(plan, plan.extraConfigs);
    await writeExtraPathManifest(plan, plan.extraSecrets);
}
export function normalizeSymlinkLinkValue(linkValue) {
    return linkValue.replace(/\\/g, '/');
}
async function copyItem(sourcePath, destinationPath, type, removeWhenMissing = false) {
    if (!(await pathExists(sourcePath))) {
        if (removeWhenMissing) {
            await removePath(destinationPath);
        }
        return;
    }
    if (type === 'file') {
        await copyFileWithMode(sourcePath, destinationPath);
        return;
    }
    await removePath(destinationPath);
    await copyDirRecursive(sourcePath, destinationPath);
}
async function copyConfigForRepo(item, overrides, repoRoot, configOverride) {
    if (!(await pathExists(item.localPath))) {
        await removePath(item.repoPath);
        return;
    }
    const localConfig = configOverride ??
        parseJsonc(await fs.readFile(item.localPath, 'utf8'));
    const baseConfig = await readRepoConfig(item, repoRoot);
    const effectiveOverrides = overrides ?? {};
    if (baseConfig) {
        const expectedLocal = deepMerge(baseConfig, effectiveOverrides);
        if (isDeepEqual(localConfig, expectedLocal)) {
            return;
        }
    }
    const stripped = stripOverrides(localConfig, effectiveOverrides, baseConfig);
    const stat = await fs.stat(item.localPath);
    await fs.mkdir(path.dirname(item.repoPath), { recursive: true });
    await writeJsonFile(item.repoPath, stripped, {
        jsonc: item.localPath.endsWith('.jsonc'),
        mode: stat.mode & 0o777,
    });
}
async function readRepoConfig(item, repoRoot) {
    if (!item.repoPath.startsWith(repoRoot)) {
        return null;
    }
    if (!(await pathExists(item.repoPath))) {
        return null;
    }
    const content = await fs.readFile(item.repoPath, 'utf8');
    return parseJsonc(content);
}
async function applyOverridesToLocalConfig(plan, overrides) {
    const configFiles = plan.items.filter((item) => item.isConfigFile);
    for (const item of configFiles) {
        if (!(await pathExists(item.localPath)))
            continue;
        const content = await fs.readFile(item.localPath, 'utf8');
        const parsed = parseJsonc(content);
        const merged = deepMerge(parsed, overrides);
        const stat = await fs.stat(item.localPath);
        await writeJsonFile(item.localPath, merged, {
            jsonc: item.localPath.endsWith('.jsonc'),
            mode: stat.mode & 0o777,
        });
    }
}
async function copyFileWithMode(sourcePath, destinationPath) {
    const stat = await fs.stat(sourcePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.copyFile(sourcePath, destinationPath);
    await chmodIfExists(destinationPath, stat.mode & 0o777);
}
async function copyDirRecursive(sourcePath, destinationPath) {
    const stat = await fs.stat(sourcePath);
    await fs.mkdir(destinationPath, { recursive: true });
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
        const entrySource = path.join(sourcePath, entry.name);
        const entryDest = path.join(destinationPath, entry.name);
        if (entry.isDirectory()) {
            await copyDirRecursive(entrySource, entryDest);
            continue;
        }
        if (entry.isFile()) {
            await copyFileWithMode(entrySource, entryDest);
            continue;
        }
        if (entry.isSymbolicLink()) {
            await copySymlink(entrySource, entryDest);
        }
    }
    await chmodIfExists(destinationPath, stat.mode & 0o777);
}
async function copySymlink(sourcePath, destinationPath) {
    const linkTarget = await fs.readlink(sourcePath);
    await fs.mkdir(path.dirname(destinationPath), { recursive: true });
    await removePath(destinationPath);
    await fs.symlink(linkTarget, destinationPath);
}
async function removePath(targetPath) {
    await fs.rm(targetPath, { recursive: true, force: true });
}
async function applyExtraPaths(plan, extra) {
    const allowlist = extra.allowlist;
    if (allowlist.length === 0)
        return;
    if (!(await pathExists(extra.manifestPath)))
        return;
    const manifestContent = await fs.readFile(extra.manifestPath, 'utf8');
    const manifest = parseJsonc(manifestContent);
    for (const entry of manifest.entries) {
        const normalized = normalizePath(entry.sourcePath, plan.homeDir, plan.platform);
        const isAllowed = allowlist.includes(normalized);
        if (!isAllowed)
            continue;
        const repoPath = resolveManifestRepoPath(plan.repoRoot, entry.repoPath);
        const localPath = expandHome(entry.sourcePath, plan.homeDir);
        const entryType = entry.type ?? 'file';
        if (!(await pathExists(repoPath)))
            continue;
        await copyItem(repoPath, localPath, entryType);
        await applyExtraPathModes(localPath, entry);
    }
}
async function writeExtraPathManifest(plan, extra) {
    const allowlist = extra.allowlist;
    const extraDir = path.join(path.dirname(extra.manifestPath), 'extra');
    if (allowlist.length === 0) {
        await removePath(extra.manifestPath);
        await removePath(extraDir);
        return;
    }
    await removePath(extraDir);
    const entries = [];
    for (const entry of extra.entries) {
        const sourcePath = expandHome(entry.sourcePath, plan.homeDir);
        const manifestSourcePath = entry.sourcePath;
        if (!(await pathExists(sourcePath))) {
            continue;
        }
        const stat = await fs.stat(sourcePath);
        if (stat.isDirectory()) {
            await copyDirRecursive(sourcePath, entry.repoPath);
            const items = await collectExtraPathItems(sourcePath, sourcePath);
            entries.push({
                sourcePath: manifestSourcePath,
                repoPath: path.relative(plan.repoRoot, entry.repoPath),
                type: 'dir',
                mode: stat.mode & 0o777,
                items,
            });
            continue;
        }
        if (stat.isFile()) {
            await copyFileWithMode(sourcePath, entry.repoPath);
            entries.push({
                sourcePath: manifestSourcePath,
                repoPath: path.relative(plan.repoRoot, entry.repoPath),
                type: 'file',
                mode: stat.mode & 0o777,
            });
        }
    }
    await fs.mkdir(path.dirname(extra.manifestPath), { recursive: true });
    await writeJsonFile(extra.manifestPath, { entries }, { jsonc: false });
}
async function collectExtraPathItems(sourcePath, basePath) {
    const items = [];
    const entries = await fs.readdir(sourcePath, { withFileTypes: true });
    for (const entry of entries) {
        const entrySource = path.join(sourcePath, entry.name);
        const relativePath = path.relative(basePath, entrySource);
        if (entry.isDirectory()) {
            const stat = await fs.stat(entrySource);
            items.push({
                relativePath,
                type: 'dir',
                mode: stat.mode & 0o777,
            });
            const nested = await collectExtraPathItems(entrySource, basePath);
            items.push(...nested);
            continue;
        }
        if (entry.isFile()) {
            const stat = await fs.stat(entrySource);
            items.push({
                relativePath,
                type: 'file',
                mode: stat.mode & 0o777,
            });
        }
    }
    return items;
}
async function applyExtraPathModes(targetPath, entry) {
    if (entry.mode !== undefined) {
        await chmodIfExists(targetPath, entry.mode);
    }
    if (entry.type !== 'dir') {
        return;
    }
    if (!entry.items || entry.items.length === 0) {
        return;
    }
    for (const item of entry.items) {
        if (item.mode === undefined)
            continue;
        const itemPath = resolveExtraPathItem(targetPath, item.relativePath);
        if (!itemPath)
            continue;
        await chmodIfExists(itemPath, item.mode);
    }
}
function resolveExtraPathItem(basePath, relativePath) {
    if (!relativePath)
        return null;
    if (path.isAbsolute(relativePath))
        return null;
    const resolvedBase = path.resolve(basePath);
    const resolvedPath = path.resolve(basePath, relativePath);
    const relative = path.relative(resolvedBase, resolvedPath);
    if (relative === '..' || relative.startsWith(`..${path.sep}`)) {
        return null;
    }
    if (path.isAbsolute(relative)) {
        return null;
    }
    return resolvedPath;
}
function resolveManifestRepoPath(repoRoot, manifestRepoPath) {
    if (path.isAbsolute(manifestRepoPath)) {
        throw new Error('Invalid extra manifest repoPath: absolute paths are not allowed');
    }
    const resolvedRepoRoot = path.resolve(repoRoot);
    const resolvedRepoPath = path.resolve(repoRoot, manifestRepoPath);
    const relativePath = path.relative(resolvedRepoRoot, resolvedRepoPath);
    const outsideRepo = relativePath === '..' ||
        relativePath.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativePath);
    if (outsideRepo) {
        throw new Error('Invalid extra manifest repoPath: path escapes repository root');
    }
    return resolvedRepoPath;
}
function isDeepEqual(left, right) {
    if (left === right)
        return true;
    if (typeof left !== typeof right)
        return false;
    if (!left || !right)
        return false;
    if (Array.isArray(left) && Array.isArray(right)) {
        if (left.length !== right.length)
            return false;
        for (let i = 0; i < left.length; i += 1) {
            if (!isDeepEqual(left[i], right[i]))
                return false;
        }
        return true;
    }
    if (typeof left === 'object' && typeof right === 'object') {
        const leftKeys = Object.keys(left);
        const rightKeys = Object.keys(right);
        if (leftKeys.length !== rightKeys.length)
            return false;
        for (const key of leftKeys) {
            if (!hasOwn(right, key))
                return false;
            if (!isDeepEqual(left[key], right[key])) {
                return false;
            }
        }
        return true;
    }
    return false;
}
async function rewriteAbsoluteOpencodeSymlinks(rootPath, opencodeRoot) {
    if (!(await pathExists(rootPath)))
        return;
    const entries = await fs.readdir(rootPath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(rootPath, entry.name);
        if (entry.isDirectory()) {
            await rewriteAbsoluteOpencodeSymlinks(entryPath, opencodeRoot);
            continue;
        }
        if (!entry.isSymbolicLink()) {
            continue;
        }
        const linkTarget = await fs.readlink(entryPath);
        if (!path.isAbsolute(linkTarget)) {
            continue;
        }
        const mappedTarget = mapAbsoluteOpencodePath(linkTarget, opencodeRoot);
        if (!mappedTarget) {
            continue;
        }
        const portableTarget = path.relative(path.dirname(entryPath), mappedTarget);
        await removePath(entryPath);
        await fs.symlink(portableTarget, entryPath);
    }
}
function mapAbsoluteOpencodePath(absoluteTarget, opencodeRoot) {
    const normalized = absoluteTarget.replace(/\\/g, '/');
    const marker = '/.config/opencode/';
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex === -1) {
        return null;
    }
    const suffix = normalized.slice(markerIndex + marker.length);
    if (!suffix) {
        return opencodeRoot;
    }
    return path.join(opencodeRoot, ...suffix.split('/').filter(Boolean));
}
async function ensureOpencodeCompatibilitySymlinks(configRoot) {
    const skillTarget = path.join(configRoot, 'superpowers', 'skills');
    const skillLink = path.join(configRoot, 'skills', 'superpowers');
    await ensureRelativeSymlink(skillLink, skillTarget);
    const pluginTarget = path.join(configRoot, 'superpowers', '.opencode', 'plugins', 'superpowers.js');
    const pluginLink = path.join(configRoot, 'plugins', 'superpowers.js');
    await ensureRelativeSymlink(pluginLink, pluginTarget);
}
async function ensureRelativeSymlink(linkPath, targetPath) {
    if (!(await pathExists(targetPath))) {
        return;
    }
    const expectedTarget = path.resolve(targetPath);
    const expectedLinkValue = normalizeSymlinkLinkValue(path.relative(path.dirname(linkPath), expectedTarget));
    const existing = await getPathLstat(linkPath);
    if (existing && !existing.isSymbolicLink()) {
        await removePath(linkPath);
    }
    if (existing?.isSymbolicLink()) {
        const currentLinkValue = await fs.readlink(linkPath);
        const currentResolvedTarget = path.resolve(path.dirname(linkPath), currentLinkValue);
        const normalizedCurrentLinkValue = normalizeSymlinkLinkValue(currentLinkValue);
        const isCorrectTarget = currentResolvedTarget === expectedTarget;
        const isPortableTarget = normalizedCurrentLinkValue === expectedLinkValue;
        if (isCorrectTarget && isPortableTarget) {
            return;
        }
        await removePath(linkPath);
    }
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(expectedLinkValue, linkPath);
}
async function getPathLstat(targetPath) {
    try {
        return await fs.lstat(targetPath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
