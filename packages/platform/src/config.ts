import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IEventSink } from './events/interface.js';
import type { ISolveMetricSink } from './metrics/interface.js';
import type { IBindingResolver } from './bindings/interface.js';

/**
 * `single`: one org per deployment, created at setup; `ctx.actingOrgId` resolves to it for
 * every user. `multi`: orgs are first-class, created by users; `ctx.actingOrgId` resolves
 * per-request.
 */
export type TenancyMode = 'single' | 'multi';

/** White-label branding. Omitted fields fall back to "Selva" defaults in the selva app. */
export interface SelvaBranding {
	name?: string;
	copyrightName?: string;
	tagline?: string;
	description?: string;
}

/** Opt-in platform features. All default false when absent. */
export interface SelvaFlags {
	/** Projects with `visibility='public'` visible across orgs on the instance. */
	ALLOW_CROSS_ORG_PUBLIC?: boolean;
	/** Orgs may override the instance compute pool with their own server. */
	ALLOW_ORG_COMPUTE_OVERRIDE?: boolean;
	/** Authenticated users may create new orgs. */
	ALLOW_ORG_CREATION?: boolean;
	/**
	 * Anonymous external access via tokenized URLs. When off, share-link admin
	 * routes reject mint/list/revoke and existing tokens stop resolving.
	 */
	ENABLE_SHARING?: boolean;
	/**
	 * Projects owned by instance admins, granted to orgs or users without normal
	 * membership. When off, `/admin/projects` 404s and platform-visibility
	 * projects are hidden and inaccessible; data survives the toggle either way.
	 */
	ENABLE_PLATFORM_PROJECTS?: boolean;
}

export interface SelvaConfig {
	tenancy?: TenancyMode;
	flags?: SelvaFlags;
	branding?: SelvaBranding;
	auth: IAuthProvider;
	/** Orgs, projects, members, definitions, compute config, user profiles, platform permissions. */
	data: IDataProvider;
	/** Blob storage — .gh/.ghx files, archived versions, images. */
	storage: IStorageProvider;
	/** Defaults to `NoopEventSink`. */
	events?: IEventSink;
	/** Records per-solve wall time. Defaults to `NoopSolveMetricSink`, which discards every metric. */
	solveMetrics?: ISolveMetricSink;
	/**
	 * Resolves values for inputs marked `source.kind === 'server'`. Defaults to
	 * `NoopBindingResolver`, which resolves nothing — hosts that use server-resolved
	 * inputs must supply a real resolver.
	 */
	bindingResolver?: IBindingResolver;
}

export type SelvaConfigFactory = (env: Record<string, string | undefined>) => SelvaConfig;

export function isFlagEnabled(config: SelvaConfig, flag: keyof SelvaFlags): boolean {
	return Boolean(config.flags?.[flag]);
}

/** Identity function for type inference and IDE autocomplete. */
export function defineConfig(
	config: SelvaConfig | SelvaConfigFactory
): SelvaConfig | SelvaConfigFactory {
	return config;
}
