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

/**
 * Platform-level feature flags. Each flag gates behavior the spec explicitly
 * designed for but that an operator must opt into. All default to `false` when
 * absent — the safer posture for self-hosted and early SaaS deployments.
 *
 * These are read at request time via `isFlagEnabled` so a config hot-reload
 * (if any) picks up changes without an app restart.
 */
export interface SelvaFlags {
	/**
	 * Allow projects with `visibility='public'` to be visible across orgs on
	 * the instance. When false, `public` effectively means "public inside the
	 * one org" — correct for single-tenant deployments. See spec §4.
	 */
	ALLOW_CROSS_ORG_PUBLIC?: boolean;
	/**
	 * Allow an org to override the instance compute pool with its own
	 * Rhino.Compute server. Until enabled, `manage_org_compute` is inert and
	 * every solve uses the instance default. See spec §3 "Compute (BYO override)".
	 */
	ALLOW_ORG_COMPUTE_OVERRIDE?: boolean;
	/**
	 * Allow authenticated users to create new orgs. Self-hosted / single-tenant
	 * deployments keep this off; only the platform admin provisions orgs.
	 * See spec §2.
	 */
	ALLOW_ORG_CREATION?: boolean;
}

export interface SelvaConfig {
	/** Tenancy model. Defaults to `single` if omitted. */
	tenancy?: TenancyMode;

	/**
	 * Platform-level feature flags. Omitted flags default to `false` (safest
	 * posture). See `SelvaFlags` for the individual toggles.
	 */
	flags?: SelvaFlags;

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
 * Safe accessor for a platform flag. Omitted flags resolve to `false` — never
 * assume a flag's value by reading the object directly, since the block itself
 * is optional.
 */
export function isFlagEnabled(config: SelvaConfig, flag: keyof SelvaFlags): boolean {
	return Boolean(config.flags?.[flag]);
}

/**
 * Same pattern as Vite's defineConfig — exists only for TypeScript inference and IDE autocomplete.
 * Use the factory form so each provider owns its own env var validation via fromEnv().
 */
export function defineConfig(
	config: SelvaConfig | SelvaConfigFactory
): SelvaConfig | SelvaConfigFactory {
	return config;
}
