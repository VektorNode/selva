import { env } from '$env/dynamic/private';
import rawConfig from '../../../../../selva.config.js';
import type { SelvaConfig, SelvaConfigFactory } from '@selva/platform';
import { DefinitionService } from '@selva/platform';

const _raw = rawConfig as SelvaConfig | SelvaConfigFactory;
export const providers: SelvaConfig = typeof _raw === 'function' ? _raw(env) : _raw;

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

export function getDefinitionMeta() {
	return providers.data.definitions;
}

export function getComputeServerConfigStore() {
	return providers.data.computeServer;
}
