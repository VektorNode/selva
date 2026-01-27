/**
 * Public API for definitions - DI system
 * This module provides the main entry point for definition loading
 */

export { DefinitionFactory } from './definitions/factory';
export { DefinitionContainer } from './definitions/container';
export type {
	DefinitionMetadata,
	Definition,
	IDefinitionLoader,
	DefinitionsConfig,
	DefinitionFileType
} from './definitions/types';

import { DefinitionFactory } from './definitions/factory';

// Singleton instance - created once and reused
let _definitionContainer: ReturnType<typeof DefinitionFactory.createContainer> | null = null;

/**
 * Get the definition container (singleton)
 * The container type is determined by environment variables at startup
 */
export function getDefinitionContainer() {
	if (!_definitionContainer) {
		_definitionContainer = DefinitionFactory.createContainer();
	}
	return _definitionContainer;
}
