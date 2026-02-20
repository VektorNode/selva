import { env } from '$env/dynamic/private';
import type { IDefinitionLoader, IDefinitionStore, DefinitionFileType } from './types';
import { FilesystemDefinitionLoader } from './loaders/filesystem';
import { FilesystemDefinitionStore } from './stores/filesystem';
import { DefinitionContainer } from './container';

export interface DefinitionFactoryConfig {
	/**
	 * Path to the definitions directory
	 * Example: './definitions', '/opt/grasshopper-defs', 'C:\\definitions'
	 */
	definitionsPath?: string;

	/**
	 * Supported file extensions ['gh', 'ghx']
	 * Restricts which file types are allowed
	 */
	supportedExtensions?: DefinitionFileType[];
}

/**
 * Factory for creating definition loaders
 *
 * Responsible for:
 * - Creating the filesystem loader
 * - Wrapping loaders in a unified container interface
 */
export class DefinitionFactory {
	/**
	 * Create a filesystem definition loader
	 *
	 * @param config - Configuration options (optional)
	 * @returns IDefinitionLoader instance (FilesystemDefinitionLoader)
	 *
	 * @example
	 * // Create filesystem loader with default path
	 * const loader = DefinitionFactory.createLoader();
	 *
	 * @example
	 * // Create filesystem loader with custom path
	 * const loader = DefinitionFactory.createLoader({
	 *   definitionsPath: '/opt/grasshopper-definitions'
	 * });
	 */
	static createLoader(config: DefinitionFactoryConfig = {}): IDefinitionLoader {
		return new FilesystemDefinitionLoader({
			definitionsPath: config.definitionsPath || env.GH_DEFINITIONS_PATH || './definitions',
			supportedExtensions: config.supportedExtensions
		});
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
	 * // Most common usage
	 * const container = DefinitionFactory.createContainer();
	 * const definitions = await container.listDefinitions();
	 *
	 * @example
	 * // Custom path
	 * const container = DefinitionFactory.createContainer({
	 *   definitionsPath: './my-definitions'
	 * });
	 */
	static createContainer(config: DefinitionFactoryConfig = {}): DefinitionContainer {
		const loader = this.createLoader(config);
		return new DefinitionContainer(loader);
	}

	/**
	 * Create a write-capable definition store for filesystem operations
	 */
	static createStore(config: DefinitionFactoryConfig = {}): IDefinitionStore {
		const definitionsPath = config.definitionsPath || env.GH_DEFINITIONS_PATH || './definitions';
		return new FilesystemDefinitionStore(definitionsPath);
	}
}
