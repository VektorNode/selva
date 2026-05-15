import { env } from '$env/dynamic/private';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import type {
	IAuthProvider,
	IDataProvider,
	IStorageProvider,
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { defineConfig, isFlagEnabled } from '@selvajs/platform';
import * as local from '@selvajs/local-provider';
import * as supa from '@selvajs/supabase-provider';
import * as header from '@selvajs/header-auth-provider';
import { DefinitionService } from './definitions/DefinitionService.js';

/**
 * Provider wiring source. Two modes:
 *
 *   Default — providers are picked from env vars (SELVA_AUTH_PROVIDER etc.)
 *   and instantiated via the bundled provider implementations. New deployments
 *   need only a .env file — no selva.config.js.
 *
 *   Override — set `SELVA_CONFIG_PATH` to point at an external
 *   `selva.config.js` (absolute or CWD-relative). The runtime loads it
 *   dynamically at boot, replacing the default env-driven wiring entirely.
 *   Use this only when you need a custom provider not shipped in the box.
 *
 * The override path must resolve to an actual `.js` file — there's no TS
 * compiler at runtime.
 */

type Env = Record<string, string | undefined>;

function envBool(e: Env, key: string): boolean {
	const v = e[key]?.toLowerCase();
	return v === 'true' || v === '1' || v === 'yes';
}

function pickAuth(e: Env): IAuthProvider {
	const choice = (e.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalAuthProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseAuthProvider.fromEnv(e);
		case 'header':
			return header.HeaderAuthProvider.fromEnv(e);
		default:
			throw new Error(
				`Unknown SELVA_AUTH_PROVIDER="${choice}". Expected: local | supabase | header.`
			);
	}
}

function pickData(e: Env): IDataProvider {
	const choice = (e.SELVA_DATA_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalDataProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseDataProvider.fromEnv(e);
		default:
			throw new Error(`Unknown SELVA_DATA_PROVIDER="${choice}". Expected: local | supabase.`);
	}
}

function pickStorage(e: Env): IStorageProvider {
	const choice = (e.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase();
	switch (choice) {
		case 'local':
			return local.LocalStorageProvider.fromEnv(e);
		case 'supabase':
			return supa.SupabaseStorageProvider.fromEnv(e);
		default:
			throw new Error(`Unknown SELVA_STORAGE_PROVIDER="${choice}". Expected: local | supabase.`);
	}
}

function pickTenancy(e: Env): TenancyMode {
	const choice = (e.SELVA_TENANCY ?? 'single').toLowerCase();
	if (choice !== 'single' && choice !== 'multi') {
		throw new Error(`Unknown SELVA_TENANCY="${choice}". Expected: single | multi.`);
	}
	return choice;
}

const defaultConfig = defineConfig((e) => ({
	tenancy: pickTenancy(e),
	flags: {
		ALLOW_CROSS_ORG_PUBLIC: envBool(e, 'SELVA_FLAG_ALLOW_CROSS_ORG_PUBLIC'),
		ALLOW_ORG_COMPUTE_OVERRIDE: envBool(e, 'SELVA_FLAG_ALLOW_ORG_COMPUTE_OVERRIDE'),
		ALLOW_ORG_CREATION: envBool(e, 'SELVA_FLAG_ALLOW_ORG_CREATION'),
		ENABLE_PLATFORM_PROJECTS: envBool(e, 'SELVA_FLAG_ENABLE_PLATFORM_PROJECTS'),
		ENABLE_SHARING: envBool(e, 'SELVA_FLAG_ENABLE_SHARING')
	},
	branding: {
		name: e.SELVA_BRAND_NAME,
		copyrightName: e.SELVA_BRAND_COPYRIGHT_NAME,
		tagline: e.SELVA_BRAND_TAGLINE,
		description: e.SELVA_BRAND_DESCRIPTION
	},
	auth: pickAuth(e),
	data: pickData(e),
	storage: pickStorage(e)
}));

async function loadRawConfig(): Promise<SelvaConfig | SelvaConfigFactory> {
	const override = env.SELVA_CONFIG_PATH;
	if (!override) {
		return defaultConfig;
	}

	const abs = resolvePath(process.cwd(), override);
	if (!existsSync(abs)) {
		throw new Error(`SELVA_CONFIG_PATH=${override} resolved to ${abs} which does not exist.`);
	}
	// Dynamic specifier — Vite must not pre-resolve this at build time, hence
	// @vite-ignore. pathToFileURL keeps Windows absolute paths valid as ESM
	// specifiers.
	const mod = (await import(/* @vite-ignore */ pathToFileURL(abs).href)) as {
		default: SelvaConfig | SelvaConfigFactory;
	};
	return mod.default;
}

const _raw = await loadRawConfig();
export const providers: SelvaConfig = typeof _raw === 'function' ? _raw(env) : _raw;

export const tenancy: TenancyMode = providers.tenancy ?? 'single';

// One-line boot summary so operators can confirm at a glance what got wired
// without grepping env vars or reading the config file. Provider names come
// from the IAuthProvider.name field; data/storage adapters don't expose a
// name, so we infer from the constructor.
console.log(
	`[selva] providers wired: ` +
		`auth=${providers.auth.name} ` +
		`data=${providers.data.constructor.name} ` +
		`storage=${providers.storage.constructor.name} ` +
		`tenancy=${tenancy}` +
		(env.SELVA_CONFIG_PATH ? ` config=${env.SELVA_CONFIG_PATH}` : '')
);

const _brand = providers.branding ?? {};
const _name = _brand.name?.trim() || 'Selva';
/**
 * Resolved branding — every field has a default so the UI never has to
 * null-check. White-label deployments override via SELVA_BRAND_* env vars.
 */
export const branding: Required<SelvaBranding> = {
	name: _name,
	copyrightName: _brand.copyrightName?.trim() || _name,
	tagline: _brand.tagline?.trim() || 'Turn Grasshopper definitions into tools anyone can use.',
	description:
		_brand.description?.trim() ||
		`Build and deploy interactive web applications powered by Grasshopper definitions with ${_name}.`
};

export const flags: SelvaFlags = providers.flags ?? {};
/** Use this rather than reading `flags` directly — omitted flags resolve to false. */
export function flag(name: keyof SelvaFlags): boolean {
	return isFlagEnabled(providers, name);
}

export const definitionService = new DefinitionService(providers.data, providers.storage);

export function getAuthProvider() {
	return providers.auth;
}

export function getStorageProvider() {
	return providers.storage;
}

export function getDataProvider() {
	return providers.data;
}

export function getOrganizationProvider() {
	return providers.data.orgs;
}

export function getProjectProvider() {
	return providers.data.projects;
}

export function getDefinitionMeta() {
	return providers.data.definitions;
}

export function getComputeServerConfigStore() {
	return providers.data.computeServer;
}

export function getUserProfileStore() {
	return providers.data.userProfile;
}

export function getInviteStore() {
	return providers.data.invites;
}

export function getPermissionStore() {
	return providers.data.permissions;
}

export function getPlatformProjectGrantStore() {
	return providers.data.platformProjectGrants;
}

/**
 * Optional. Null on deployments where the audit log isn't queryable
 * (local-provider stays on `NoopEventSink`; the read-side has nothing to
 * surface). Routes that consume this MUST handle null and degrade their UI.
 */
export function getAuditQuery() {
	return providers.data.auditQuery ?? null;
}
