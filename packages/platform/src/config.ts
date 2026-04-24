import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IUserProfileStore } from './userProfile/interface.js';

/**
 * Tenancy model.
 *
 * - `single`: one org per deployment. Setup creates it; `ctx.actingOrgId` resolves
 *   to that org for every authenticated user. Multi-org APIs (createOrg,
 *   listOrgs of *other* orgs) are not exposed in the UI.
 * - `multi`: orgs are first-class. Setup creates only a platform admin;
 *   orgs are created later by users. `ctx.actingOrgId` is resolved per-request
 *   from the URL prefix or session.
 */
export type TenancyMode = 'single' | 'multi';

export interface SelvaConfig {
	/** Tenancy model. Defaults to `single` if omitted. */
	tenancy?: TenancyMode;

	/** Auth provider — session tokens and identity verification only. */
	auth: IAuthProvider;

	/**
	 * Structured data provider — orgs, projects, members, definition metadata,
	 * and compute server configuration.
	 * To add a new entity type, extend IDataProvider rather than adding a new key here.
	 */
	data: IDataProvider;

	/**
	 * Blob storage provider — .gh/.ghx files, archived versions, images.
	 * Generic path-based interface: works with filesystem, S3, Firebase Storage, etc.
	 */
	storage: IStorageProvider;

	/**
	 * User-profile data store — display name, starred definitions, recent runs.
	 * Kept separate from `auth` so OAuth providers (Entra, Supabase Auth) don't
	 * have to stub out profile state — identity comes from the IdP, profile
	 * state from your DB.
	 */
	userProfile: IUserProfileStore;
}

export type SelvaConfigFactory = (env: Record<string, string | undefined>) => SelvaConfig;

/**
 * Same pattern as Vite's defineConfig — exists only for TypeScript inference and IDE autocomplete.
 * Use the factory form so each provider owns its own env var validation via fromEnv().
 */
export function defineConfig(
	config: SelvaConfig | SelvaConfigFactory
): SelvaConfig | SelvaConfigFactory {
	return config;
}
