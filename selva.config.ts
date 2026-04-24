import { defineConfig } from '@selva/platform/config';
import {
	LocalAuthProvider,
	LocalDataProvider,
	LocalStorageProvider,
	LocalUserProfileProvider
} from 'selva-local-provider';

export default defineConfig((env) => ({
	auth: LocalAuthProvider.fromEnv(env),
	data: LocalDataProvider.fromEnv(env),
	storage: LocalStorageProvider.fromEnv(env),
	userProfile: LocalUserProfileProvider.fromEnv(env)
}));
