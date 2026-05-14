import { env } from '$env/dynamic/private';
import { pathToFileURL } from 'node:url';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import bundledConfig from '../../../../../selva.config.js';
import type {
	SelvaBranding,
	SelvaConfig,
	SelvaConfigFactory,
	SelvaFlags,
	TenancyMode
} from '@selvajs/platform';
import { isFlagEnabled } from '@selvajs/platform';
import { DefinitionService } from './definitions/DefinitionService.js';

/**
 * Provider wiring source. Two modes:
 *
 *   Default — `selva.config.ts` from the repo root is bundled into the build
 *   at compile time (the static import above). This is the dev workflow and
 *   the no-configuration deployment shape.
 *
 *   Override — set `SELVA_CONFIG_PATH` to point at an external
 *   `selva.config.js` (absolute or CWD-relative). The runtime loads it
 *   dynamically at boot, so the file can be edited *after* the build
 *   without rebuilding. This is the white-label deployment shape: the
 *   prebuilt runtime ships once, every customer points at their own
 *   config file.
 *
 * The override path must resolve to an actual `.js` file — there's no TS
 * compiler at runtime. The deployment-build script is responsible for
 * compiling `selva.config.ts` to `selva.config.js` and shipping the result.
 */
async function loadRawConfig(): Promise<SelvaConfig | SelvaConfigFactory> {
	const override = env.SELVA_CONFIG_PATH;
	if (!override) {
		return bundledConfig as SelvaConfig | SelvaConfigFactory;
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
