import { defineConfig } from '@selva/platform/config';
import {
	LocalAuthProvider,
	LocalDefinitionFileProvider,
	LocalDefinitionMetaProvider,
	FilesystemComputeProvider
} from 'selva-local-provider';
import * as path from 'node:path';
import * as process from 'node:process';

// Providers are constructed lazily so that process.env is read on first access
// (during a request) rather than at module load time — avoiding issues when
// Vite evaluates the module before it has loaded the .env file.

let _auth: LocalAuthProvider | undefined;
let _files: LocalDefinitionFileProvider | undefined;
let _meta: LocalDefinitionMetaProvider | undefined;
let _compute: FilesystemComputeProvider | undefined;

export default defineConfig({
	get auth() {
		return (_auth ??= new LocalAuthProvider({
			hmacSecret: (process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD)!,
			usersFilePath: process.env.GH_DEFINITIONS_PATH
				? path.join(process.env.GH_DEFINITIONS_PATH, 'users.json')
				: undefined,
			fallbackAdminPassword: process.env.ADMIN_PASSWORD
		}));
	},

	get definitionFiles() {
		return (_files ??= new LocalDefinitionFileProvider(
			process.env.GH_DEFINITIONS_PATH!,
			'/api/definitions'
		));
	},

	get definitionMeta() {
		return (_meta ??= new LocalDefinitionMetaProvider(process.env.GH_DEFINITIONS_PATH!));
	},

	get compute() {
		return (_compute ??= new FilesystemComputeProvider(
			path.join(process.env.GH_DEFINITIONS_PATH!, 'compute.config.json')
		));
	}
});
