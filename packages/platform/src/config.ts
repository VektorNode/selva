import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';
import type { IEventSink } from './events/interface.js';
import type { IBindingResolver } from './bindings/interface.js';

/**
 * - `single`: one org per deployment. Setup creates it; `ctx.actingOrgId`
 *   resolves to that org for every authenticated user.
 * - `multi`: orgs are first-class. Setup creates only a platform admin; orgs
 *   are created by users. `ctx.actingOrgId` resolves per-request.
 */
export type TenancyMode = 'single' | 'multi';

/**
 * White-label branding. All fields optional; the selva app applies sensible
 * "Selva" defaults for anything omitted. Use this to rebrand the instance
 * (header name, footer copyright, landing-page copy, page titles) without
 * forking the UI.
 */
export interface SelvaBranding {
	/** Product name shown in header, footer, page titles. Default: "Selva". */
	name?: string;
	/** Footer copyright owner. Default: same as `name`. */
	copyrightName?: string;
	/** Landing-page tagline under the product name. */
	tagline?: string;
	/** Meta description for SEO / social previews. */
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
	 * Per-definition share links — anonymous external access via tokenized URLs.
	 * When off, share-link admin routes reject mint/list/revoke and the
	 * token-resolution path stops honouring any existing tokens.
	 */
	ENABLE_SHARING?: boolean;
	/**
	 * Platform projects — projects owned by instance admins and granted to orgs
	 * or individual users without normal membership. When off, the
	 * `/admin/projects` surface 404s, platform-visibility projects are hidden
	 * from every list, and access rules treat them as inaccessible. Existing
	 * data is preserved; flipping back on restores access.
	 */
	ENABLE_PLATFORM_PROJECTS?: boolean;
}

export interface SelvaConfig {
	tenancy?: TenancyMode;
	flags?: SelvaFlags;
	branding?: SelvaBranding;
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
	 * Optional. Resolves values for inputs marked as `source.kind === 'server'`
	 * in the schema. Defaults to `NoopBindingResolver`, which returns nothing
	 * — combined with the schema's `onMissing: 'fail'` default, that causes
	 * any solve involving a server-resolved input to error loudly until a real
	 * resolver is configured. Hosts that want server-resolved inputs must supply one.
	 */
	bindingResolver?: IBindingResolver;
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
