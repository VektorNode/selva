// Auth — identity-only (auth-users.json)
export { LocalAuthProvider } from './auth/LocalAuthProvider.js';
export type { LocalAuthProviderConfig } from './auth/LocalAuthProvider.js';
export { signHmacToken, verifyHmacToken } from './auth/hmac.js';
export { hashPassword, verifyPasswordHash, createLocalAuthUserStore } from './auth/users.js';
export type { StoredAuthUser, AuthUsersFile, LocalAuthUserStore } from './auth/users.js';

// Data — class names use the `*Store` suffix to match the Supabase provider.
export {
	LocalDataProvider,
	LocalOrgStore,
	LocalOrgStoreLoader,
	LocalProjectStore,
	LocalDefinitionStore,
	LocalInviteStore,
	LocalComputeServerStore,
	LocalShareLinkStore,
	LocalPlatformProjectGrantStore
} from './data/index.js';
export type {
	LocalOrgStoreData,
	LocalOrgStoreOptions,
	LocalProjectStoreOptions,
	LocalShareLinkStoreOptions
} from './data/index.js';

// Per-user data layer (user-data.json) — keyed by user ID, paired with any
// auth provider. The permission and profile stores both read/write here.
export { createLocalUserDataStore } from './data/userData.js';
export type { LocalUserDataStore, StoredUserData, UserDataFile } from './data/userData.js';

// Storage
export { LocalStorageProvider } from './storage/LocalStorageProvider.js';

// User profile
export { LocalUserProfileProvider } from './userProfile/LocalUserProfileProvider.js';

// Platform permissions (data-layer authorization store)
export { LocalPlatformPermissionStore } from './permissions/LocalPlatformPermissionStore.js';
