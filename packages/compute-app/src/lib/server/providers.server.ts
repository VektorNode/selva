/**
 * Reads selva.config.ts and exposes typed provider accessors.
 * To swap providers: edit selva.config.ts at the repo root only.
 *
 * env vars are injected from $env/dynamic/private into process.env before
 * the config is accessed, so selva.config.ts can read them via process.env.
 */
import { env } from '$env/dynamic/private';
import config from '../../../../../selva.config.js';
import type { IAuthProvider } from '@selva/platform/auth';
import type { IOrganizationProvider } from '@selva/platform/organizations';
import type { IComputeServerProvider } from '@selva/platform/compute';
import type { IDefinitionFileProvider, IDefinitionMetaProvider } from '@selva/platform/definitions';

let envInjected = false;
function injectEnv() {
	if (envInjected) return;
	for (const [key, value] of Object.entries(env)) {
		if (value !== undefined) process.env[key] = value;
	}
	envInjected = true;
}

export function getAuthProvider(): IAuthProvider {
	injectEnv();
	return config.auth;
}

export function getOrganizationProvider(): IOrganizationProvider {
	injectEnv();
	return config.organizations;
}

export function getDefinitionFiles(): IDefinitionFileProvider {
	injectEnv();
	return config.definitionFiles;
}

export function getDefinitionMeta(): IDefinitionMetaProvider {
	injectEnv();
	return config.definitionMeta;
}

export function getComputeServerProvider(): IComputeServerProvider {
	injectEnv();
	return config.compute;
}
