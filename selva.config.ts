import { defineConfig } from '@selva/platform/config';
import {
	LocalAuthProvider,
	LocalOrganizationProvider,
	LocalDefinitionFileProvider,
	LocalDefinitionMetaProvider,
	FilesystemComputeProvider
} from 'selva-local-provider';
import * as path from 'node:path';
import * as process from 'node:process';

// Providers are constructed lazily so that process.env is read on first access
// (during a request) rather than at module load time — avoiding issues when
// Vite evaluates the module before it has loaded the .env file.

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

let _auth: LocalAuthProvider | undefined;
let _orgs: LocalOrganizationProvider | undefined;
let _files: LocalDefinitionFileProvider | undefined;
let _meta: LocalDefinitionMetaProvider | undefined;
let _compute: FilesystemComputeProvider | undefined;

export default defineConfig({
	get auth() {
		// Preference order: SESSION_SECRET (PM2) → ADMIN_SECRET (.env) → ADMIN_PASSWORD (dev fallback).
		// Avoid using ADMIN_PASSWORD in production: rotating it would silently invalidate all sessions.
		const hmacSecret = process.env.SESSION_SECRET || process.env.ADMIN_SECRET || process.env.ADMIN_PASSWORD;
		if (!hmacSecret) throw new Error('Missing required environment variable: SESSION_SECRET, ADMIN_SECRET, or ADMIN_PASSWORD');
		return (_auth ??= new LocalAuthProvider({
			hmacSecret,
			usersFilePath: process.env.GH_DEFINITIONS_PATH
				? path.join(process.env.GH_DEFINITIONS_PATH, 'users.json')
				: undefined,
			fallbackAdminPassword: process.env.ADMIN_PASSWORD
		}));
	},

	get organizations() {
		return (_orgs ??= new LocalOrganizationProvider(requireEnv('GH_DEFINITIONS_PATH')));
	},

	get definitionFiles() {
		return (_files ??= new LocalDefinitionFileProvider(
			requireEnv('GH_DEFINITIONS_PATH'),
			'/api/definitions'
		));
	},

	get definitionMeta() {
		return (_meta ??= new LocalDefinitionMetaProvider(requireEnv('GH_DEFINITIONS_PATH')));
	},

	get compute() {
		return (_compute ??= new FilesystemComputeProvider(
			path.join(requireEnv('GH_DEFINITIONS_PATH'), 'compute.config.json')
		));
	}
});
