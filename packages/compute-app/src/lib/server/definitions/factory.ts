import { env } from '$env/dynamic/private';
import type { IDefinitionLoader, DefinitionFileType } from './types';
import { FilesystemDefinitionLoader } from './loaders/filesystem';
import { EnvironmentDefinitionLoader } from './loaders/environment';
import { DefinitionContainer } from './container';

/**
 * Supported definition sources
 * - 'filesystem': Load definitions from local directory (./definitions/)
 * - 'environment': Load definitions from GH_DEF_* environment variables
 */
export type DefinitionSource = 'filesystem' | 'environment';

export interface DefinitionFactoryConfig {
	/**
	 * Which definition source to use: 'filesystem' or 'environment'
	 * If omitted, auto-detects based on environment variables
	 */
	source?: DefinitionSource;

	/**
	 * Path to the definitions directory (only for filesystem loader)
	 * Example: './definitions', '/opt/grasshopper-defs', 'C:\\definitions'
	 * Ignored if source='environment'
	 */
	definitionsPath?: string;

	/**
	 * Supported file extensions ['gh', 'ghx']
	 * Restricts which file types are allowed
	 * Only used by filesystem loader
	 */
	supportedExtensions?: DefinitionFileType[];
}

/**
 * Factory for creating definition loaders based on configuration
 *
 * Responsible for:
 * - Creating the appropriate loader (Filesystem or Environment)
 * - Auto-detecting the source from environment variables
 * - Wrapping loaders in a unified container interface
 *
 * The factory uses a precedence order for source detection:
 * 1. Explicit config.source parameter
 * 2. GH_DEFINITIONS_PATH environment variable (filesystem)
 * 3. GH_DEF_* environment variables (environment)
 * 4. Default to filesystem
 */
export class DefinitionFactory {
	/**
	 * Create a definition loader based on configuration
	 *
	 * @param config - Configuration options (optional)
	 * @returns IDefinitionLoader instance (FilesystemDefinitionLoader or EnvironmentDefinitionLoader)
	 *
	 * @example
	 * // Create filesystem loader with default path
	 * const loader = DefinitionFactory.createLoader({
	 *   source: 'filesystem'
	 * });
	 *
	 * @example
	 * // Create filesystem loader with custom path
	 * const loader = DefinitionFactory.createLoader({
	 *   source: 'filesystem',
	 *   definitionsPath: '/opt/grasshopper-definitions'
	 * });
	 *
	 * @example
	 * // Create environment loader
	 * const loader = DefinitionFactory.createLoader({
	 *   source: 'environment'
	 * });
	 *
	 * @example
	 * // Auto-detect loader based on environment
	 * const loader = DefinitionFactory.createLoader();
	 */
	static createLoader(config: DefinitionFactoryConfig = {}): IDefinitionLoader {
		const source = config.source || this.detectSource();

		switch (source) {
			case 'filesystem':
				return new FilesystemDefinitionLoader({
					definitionsPath: config.definitionsPath || env.GH_DEFINITIONS_PATH || './definitions',
					supportedExtensions: config.supportedExtensions
				});

			case 'environment':
				return new EnvironmentDefinitionLoader({
					prefix: env.GH_DEF_PREFIX || 'GH_DEF_',
					envVars: env as Record<string, string | undefined>
				});

			default:
				throw new Error(`Unknown definition source: ${source}`);
		}
	}

	/**
	 * Create a definition container with a loader
	 *
	 * This is the recommended way to initialize the definition system.
	 * The container wraps the loader and provides a unified API.
	 *
	 * @param config - Configuration options (optional)
	 * @returns DefinitionContainer - Unified interface for definition loading
	 *
	 * @example
	 * // Most common usage - auto-detect and create container
	 * const container = DefinitionFactory.createContainer();
	 * const definitions = await container.listDefinitions();
	 *
	 * @example
	 * // Explicit filesystem loader with custom path
	 * const container = DefinitionFactory.createContainer({
	 *   source: 'filesystem',
	 *   definitionsPath: './my-definitions'
	 * });
	 *
	 * @example
	 * // Explicit environment loader
	 * const container = DefinitionFactory.createContainer({
	 *   source: 'environment'
	 * });
	 */
	static createContainer(config: DefinitionFactoryConfig = {}): DefinitionContainer {
		const loader = this.createLoader(config);
		return new DefinitionContainer(loader);
	}

	private static detectSource(): DefinitionSource {
		// Priority: explicit source > filesystem path > environment vars > default
		if (env.DEFINITION_SOURCE === 'environment') {
			return 'environment';
		}

		if (env.GH_DEFINITIONS_PATH) {
			return 'filesystem';
		}

		// Check if any environment variables with the pattern exist
		if (Object.keys(process.env).some((key) => key.startsWith(env.GH_DEF_PREFIX || 'GH_DEF_'))) {
			return 'environment';
		}

		// Default to filesystem
		return 'filesystem';
	}
}
