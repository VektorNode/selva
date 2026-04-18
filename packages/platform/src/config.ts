import type { IAuthProvider } from './auth.js';
import type { IDefinitionFileProvider, IDefinitionMetaProvider } from './definitions.js';
import type { IComputeServerProvider } from './compute.js';
import type { IOrganizationProvider } from './organizations.js';

export interface SelvaConfig {
	/** Auth provider — handles session tokens and credential verification */
	auth: IAuthProvider;

	/** Organization and project provider — orgs, projects, membership, access checks */
	organizations: IOrganizationProvider;

	/** File storage provider — GH binaries, archives, preview images */
	definitionFiles: IDefinitionFileProvider;

	/** Metadata storage provider — definitions-config.json or DB */
	definitionMeta: IDefinitionMetaProvider;

	/** Compute server provider — resolves which Rhino.Compute to use */
	compute: IComputeServerProvider;
}

export type SelvaConfigFactory = (env: Record<string, string | undefined>) => SelvaConfig;

/**
 * Same pattern as Vite's `defineConfig` — exists only for TypeScript inference and IDE autocomplete.
 * Accepts either a plain config object (legacy) or a factory function that receives env vars.
 * Use the factory form so each provider owns its own env var validation via `fromEnv()`.
 */
export function defineConfig(config: SelvaConfig | SelvaConfigFactory): SelvaConfig | SelvaConfigFactory {
	return config;
}
