// Auth
export { LocalAuthProvider } from './auth/LocalAuthProvider.js';
export type { LocalAuthProviderConfig } from './auth/LocalAuthProvider.js';
export { signHmacToken, verifyHmacToken } from './auth/hmac.js';
export { hashPassword, verifyPasswordHash, createLocalUserMetaProvider } from './auth/users.js';
export type { StoredUser, UsersFile, LocalUserMetaProvider } from './auth/users.js';

// Data — internal class names use the `*Store` suffix to match the Supabase
// provider; older `*Provider` aliases are re-exported for any consumers that
// still reference them.
export {
	LocalDataProvider,
	LocalOrgStore,
	LocalOrgStoreLoader,
	LocalProjectStore,
	LocalDefinitionStore,
	LocalInviteStore,
	LocalComputeServerStore
} from './data/index.js';
export type { LocalOrgStoreData } from './data/index.js';

export { LocalOrgStore as LocalOrganizationProvider } from './data/index.js';
export { LocalProjectStore as LocalProjectProvider } from './data/index.js';
export { LocalDefinitionStore as LocalDefinitionMetaProvider } from './data/index.js';
export { LocalInviteStore as LocalInviteProvider } from './data/index.js';
export { LocalComputeServerStore as LocalComputeServerProvider } from './data/index.js';

// Storage
export { LocalStorageProvider } from './storage/LocalStorageProvider.js';

// User profile
export { LocalUserProfileProvider } from './userProfile/LocalUserProfileProvider.js';
