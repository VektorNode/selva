import type { IAuthProvider } from './auth.js';
import type { IDefinitionFileProvider, IDefinitionMetaProvider } from './definitions.js';
import type { IComputeServerProvider } from './compute.js';

export interface SelvaConfig {
	/** Auth provider — handles session tokens and credential verification */
	auth: IAuthProvider;

	/** File storage provider — GH binaries, archives, preview images */
	definitionFiles: IDefinitionFileProvider;

	/** Metadata storage provider — definitions-config.json or DB */
	definitionMeta: IDefinitionMetaProvider;

	/** Compute server provider — resolves which Rhino.Compute to use */
	compute: IComputeServerProvider;
}

/**
 * No-op identity function. Its only purpose is to give TypeScript full inference
 * and IDE autocomplete when writing `selva.config.ts`. Same pattern as Vite's `defineConfig`.
 */
export function defineConfig(config: SelvaConfig): SelvaConfig {
	return config;
}
