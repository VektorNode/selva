// Auth-only provider — pair with any data/storage/permissions provider
// (e.g. @selvajs/local-provider for the data side).
export { HeaderAuthProvider, dumpHeaders, snapshotHeaders } from './HeaderAuthProvider.js';
export type { HeaderAuthProviderConfig, BootstrapAllowlistPolicy } from './HeaderAuthProvider.js';
export { createAllowlistStore } from './users.js';
export type { AllowlistStore, AllowlistEntry } from './users.js';
