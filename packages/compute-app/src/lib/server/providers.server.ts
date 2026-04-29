import { env } from '$env/dynamic/private';
import rawConfig from '../../../../../selva.config.js';
import type { SelvaConfig, SelvaConfigFactory, SelvaFlags, TenancyMode } from '@selvajs/platform';
import { isFlagEnabled } from '@selvajs/platform';
import { DefinitionService } from './definitions/DefinitionService.js';

const _raw = rawConfig as SelvaConfig | SelvaConfigFactory;
export const providers: SelvaConfig = typeof _raw === 'function' ? _raw(env) : _raw;

export const tenancy: TenancyMode = providers.tenancy ?? 'single';

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
