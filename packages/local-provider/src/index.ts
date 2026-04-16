// ── Auth ──────────────────────────────────────────────────────────────────
export { signHmacToken, verifyHmacToken } from './auth/hmac.js';
export { hashPassword, verifyPasswordHash, createLocalUserMetaProvider } from './auth/users.js';
export { LocalAuthProvider } from './auth/LocalAuthProvider.js';
export type { LocalAuthProviderConfig } from './auth/LocalAuthProvider.js';
export type { StoredUser, UsersFile, UserRole, LocalUserMetaProvider } from './auth/users.js';

// ── Definitions ───────────────────────────────────────────────────────────
export { LocalDefinitionFileProvider } from './definitions/providers/filesystem-files.js';
export { LocalDefinitionMetaProvider } from './definitions/providers/filesystem-meta.js';
// Zod schemas live in @selva/platform/definitions/schemas — not re-exported here

// ── Compute ───────────────────────────────────────────────────────────────
export { SingleComputeServerProvider } from './compute/SingleComputeServerProvider.js';
export { FilesystemComputeProvider } from './compute/FilesystemComputeProvider.js';
export type { ComputeConfig, ComputeServerEntry } from './compute/types.js';
