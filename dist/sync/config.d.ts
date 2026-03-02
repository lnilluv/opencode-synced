import type { SyncLocations } from './paths.js';
export interface SyncRepoConfig {
    url?: string;
    owner?: string;
    name?: string;
    branch?: string;
}
export type KnownSecretsBackendType = '1password';
export type SecretsBackendType = KnownSecretsBackendType | (string & {});
export interface SecretsBackendDocuments {
    authJson?: string;
    mcpAuthJson?: string;
}
export interface SecretsBackendConfig {
    type: SecretsBackendType;
    vault?: string;
    documents?: SecretsBackendDocuments;
}
export interface SyncConfig {
    repo?: SyncRepoConfig;
    localRepoPath?: string;
    includeSecrets?: boolean;
    includeMcpSecrets?: boolean;
    includeSessions?: boolean;
    includePromptStash?: boolean;
    includeModelFavorites?: boolean;
    secretsBackend?: SecretsBackendConfig;
    extraSecretPaths?: string[];
    extraConfigPaths?: string[];
}
export interface NormalizedSyncConfig extends SyncConfig {
    includeSecrets: boolean;
    includeMcpSecrets: boolean;
    includeSessions: boolean;
    includePromptStash: boolean;
    includeModelFavorites: boolean;
    secretsBackend?: SecretsBackendConfig;
    extraSecretPaths: string[];
    extraConfigPaths: string[];
}
export interface SyncState {
    lastPull?: string;
    lastPush?: string;
    lastRemoteUpdate?: string;
    lastSecretsHash?: string;
}
export declare function pathExists(filePath: string): Promise<boolean>;
export declare function chmodIfExists(filePath: string, mode: number): Promise<void>;
export declare function isPlainObject(value: unknown): value is Record<string, unknown>;
export declare function normalizeSecretsBackend(input: SyncConfig['secretsBackend']): SecretsBackendConfig | undefined;
export declare function normalizeSyncConfig(config: SyncConfig): NormalizedSyncConfig;
export declare function canCommitMcpSecrets(config: SyncConfig): boolean;
export declare function hasSecretsBackend(config: SyncConfig | NormalizedSyncConfig): boolean;
export declare function loadSyncConfig(locations: SyncLocations): Promise<NormalizedSyncConfig | null>;
export declare function writeSyncConfig(locations: SyncLocations, config: SyncConfig): Promise<void>;
export declare function loadOverrides(locations: SyncLocations): Promise<Record<string, unknown> | null>;
export declare function loadState(locations: SyncLocations): Promise<SyncState>;
export declare function writeState(locations: SyncLocations, state: SyncState): Promise<void>;
export declare function updateState(locations: SyncLocations, update: Partial<SyncState>): Promise<void>;
export declare function applyOverridesToRuntimeConfig(config: Record<string, unknown>, overrides: Record<string, unknown>): void;
export declare function deepMerge<T>(base: T, override: unknown): T;
export declare function stripOverrides(localConfig: Record<string, unknown>, overrides: Record<string, unknown>, baseConfig: Record<string, unknown> | null): Record<string, unknown>;
export declare function parseJsonc<T>(content: string): T;
export declare function writeJsonFile(filePath: string, data: unknown, options?: {
    jsonc: boolean;
    mode?: number;
}): Promise<void>;
export declare function hasOwn(target: Record<string, unknown>, key: string): boolean;
