import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IUserProfileStore } from './userProfile/interface.js';

/**
 * - `single`: one org per deployment. Setup creates it; `ctx.actingOrgId`
 *   resolves to that org for every authenticated user.
 * - `multi`: orgs are first-class. Setup creates only a platform admin; orgs
 *   are created later by users. `ctx.actingOrgId` resolves per-request from
 *   the URL prefix or session.
 */
export type TenancyMode = 'single' | 'multi';

/**
 * Opt-in platform features. All default false when absent — the safer posture.
 * Read via `isFlagEnabled` so missing blocks resolve correctly.
 */
export interface SelvaFlags {
	/** Projects with `visibility='public'` visible across orgs on the instance. */
	ALLOW_CROSS_ORG_PUBLIC?: boolean;
	/** Orgs may override the instance compute pool with their own server. */
	ALLOW_ORG_COMPUTE_OVERRIDE?: boolean;
	/** Authenticated users may create new orgs. */
	ALLOW_ORG_CREATION?: boolean;
}

export interface SelvaConfig {
	tenancy?: TenancyMode;
	flags?: SelvaFlags;
	auth: IAuthProvider;
	/** Orgs, projects, members, definition metadata, compute config. */
	data: IDataProvider;
	/** Blob storage — .gh/.ghx files, archived versions, images. */
	storage: IStorageProvider;
	/**
	 * Kept separate from `auth` so OIDC providers don't have to stub out
	 * profile state — identity from IdP, profile state from DB.
	 */
	userProfile: IUserProfileStore;
}

export type SelvaConfigFactory = (env: Record<string, string | undefined>) => SelvaConfig;

/** Safe accessor — omitted flags resolve to false. */
export function isFlagEnabled(config: SelvaConfig, flag: keyof SelvaFlags): boolean {
	return Boolean(config.flags?.[flag]);
}

/** For TypeScript inference / IDE autocomplete only, Vite-style. */
export function defineConfig(
	config: SelvaConfig | SelvaConfigFactory
): SelvaConfig | SelvaConfigFactory {
	return config;
}
