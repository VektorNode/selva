import { env } from '$env/dynamic/private';
import rawConfig from '../../../../../selva.config.js';
import type { SelvaConfig, SelvaConfigFactory } from '@selva/platform/config';

// Resolved once at module load (server startup). selva.config.ts exports either
// a SelvaConfig object (legacy) or a factory function (current).
const _raw = rawConfig as SelvaConfig | SelvaConfigFactory;
export const providers: SelvaConfig = typeof _raw === 'function' ? _raw(env) : _raw;

export function getAuthProvider() {
	return providers.auth;
}
export function getOrganizationProvider() {
	return providers.organizations;
}
export function getDefinitionFiles() {
	return providers.definitionFiles;
}
export function getDefinitionMeta() {
	return providers.definitionMeta;
}
export function getComputeServerProvider() {
	return providers.compute;
}
