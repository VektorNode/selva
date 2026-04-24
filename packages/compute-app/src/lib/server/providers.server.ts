import { env } from '$env/dynamic/private';
import rawConfig from '../../../../../selva.config.js';
import type {
	SelvaConfig,
	SelvaConfigFactory,
	SelvaFlags,
	TenancyMode
} from '@selva/platform';
import { isFlagEnabled } from '@selva/platform';
import { DefinitionService } from './definitions/DefinitionService.js';

const _raw = rawConfig as SelvaConfig | SelvaConfigFactory;
export const providers: SelvaConfig = typeof _raw === 'function' ? _raw(env) : _raw;

/** Tenancy model from config; defaults to `single` when unset. */
export const tenancy: TenancyMode = providers.tenancy ?? 'single';

/**
 * Platform feature flags for this deployment. All default to `false` when the
 * `flags` block is omitted from `selva.config.js`. Use the `flag()` helper
 * rather than reading `flags` directly so omitted flags resolve correctly.
 */
export const flags: SelvaFlags = providers.flags ?? {};
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

// ── Convenience accessors ─────────────────────────────────────────────────────

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
	return providers.userProfile;
}

export function getInviteStore() {
	return providers.data.invites;
}
