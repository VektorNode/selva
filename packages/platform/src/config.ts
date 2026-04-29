import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IEventSink } from './events/interface.js';
import type { IAuditQuery } from './events/audit.js';

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
	/**
	 * Orgs, projects, members, definitions, compute config, user profiles,
	 * and platform permissions. All database-layer concerns live here.
	 */
	data: IDataProvider;
	/** Blob storage — .gh/.ghx files, archived versions, images. */
	storage: IStorageProvider;
	/** Optional. Defaults to `NoopEventSink`. */
	events?: IEventSink;
	/**
	 * Optional read-side for the persisted event log. Required only by the
	 * `/admin/audit` UI; absence renders the page in its "no backend wired"
	 * state (matches local-provider deployments where events are noop'd).
	 */
	auditQuery?: IAuditQuery;
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
