import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IUserProfileStore } from './userProfile/interface.js';
import type { IEventSink } from './events/interface.js';
import type { IPlatformPermissionStore } from './permissions/interface.js';

/**
 * - `single`: one org per deployment. Setup creates it; `ctx.actingOrgId`
 *   resolves to that org for every authenticated user.
 * - `multi`: orgs are first-class. Setup creates only a platform admin; orgs
 *   are created by users. `ctx.actingOrgId` resolves per-request.
 */
export type TenancyMode = 'single' | 'multi';

/** Opt-in platform features. All default false when absent. */
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
	/** Identity from the IdP, profile state from your DB. */
	userProfile: IUserProfileStore;
	/**
	 * Per-user platform permissions. Required — the sole-`instance_admin`
	 * invariant lives here.
	 */
	permissions: IPlatformPermissionStore;
	/** Optional. Defaults to `NoopEventSink`. */
	events?: IEventSink;
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
