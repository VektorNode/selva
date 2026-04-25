// Auth
export { LocalAuthProvider } from './auth/LocalAuthProvider.js';
export type { LocalAuthProviderConfig } from './auth/LocalAuthProvider.js';
export { signHmacToken, verifyHmacToken } from './auth/hmac.js';
export { hashPassword, verifyPasswordHash, createLocalUserMetaProvider } from './auth/users.js';
export type { StoredUser, UsersFile, LocalUserMetaProvider } from './auth/users.js';

// Data — class names use the `*Store` suffix to match the Supabase provider.
export {
	LocalDataProvider,
	LocalOrgStore,
	LocalOrgStoreLoader,
	LocalProjectStore,
	LocalDefinitionStore,
	LocalInviteStore,
	LocalComputeServerStore,
	LocalShareLinkStore
} from './data/index.js';
export type { LocalOrgStoreData } from './data/index.js';

// Storage
export { LocalStorageProvider } from './storage/LocalStorageProvider.js';

// User profile
export { LocalUserProfileProvider } from './userProfile/LocalUserProfileProvider.js';
