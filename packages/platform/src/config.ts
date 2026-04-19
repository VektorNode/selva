import type { IAuthProvider } from './auth/interface.js';
import type { IDataProvider } from './data/interface.js';
import type { IStorageProvider } from './storage/interface.js';

export interface SelvaConfig {
	/** Auth provider — session tokens and credential verification */
	auth: IAuthProvider;

	/**
	 * Structured data provider — orgs, projects, members, definition metadata,
	 * and compute server configuration.
	 * To add a new entity type, extend IDataProvider rather than adding a new key here.
	 */
	data: IDataProvider;

	/**
	 * Blob storage provider — .gh/.ghx files, archived versions, images.
	 * Generic path-based interface: works with filesystem, S3, Firebase Storage, etc.
	 */
	storage: IStorageProvider;
}

export type SelvaConfigFactory = (env: Record<string, string | undefined>) => SelvaConfig;

/**
 * Same pattern as Vite's defineConfig — exists only for TypeScript inference and IDE autocomplete.
 * Use the factory form so each provider owns its own env var validation via fromEnv().
 */
export function defineConfig(
	config: SelvaConfig | SelvaConfigFactory
): SelvaConfig | SelvaConfigFactory {
	return config;
}
