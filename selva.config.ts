import { defineConfig } from '@selva/platform/config';
import {
	LocalAuthProvider,
	LocalOrganizationProvider,
	LocalDefinitionFileProvider,
	LocalDefinitionMetaProvider,
	FilesystemComputeProvider
} from 'selva-local-provider';

export default defineConfig((env) => ({
	auth: LocalAuthProvider.fromEnv(env),
	organizations: LocalOrganizationProvider.fromEnv(env),
	definitionFiles: LocalDefinitionFileProvider.fromEnv(env),
	definitionMeta: LocalDefinitionMetaProvider.fromEnv(env),
	compute: FilesystemComputeProvider.fromEnv(env)
}));
