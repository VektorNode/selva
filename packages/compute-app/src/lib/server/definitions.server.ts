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
	IDefinitionStore,
	DefinitionsConfig,
	DefinitionFileType,
	FileInput,
	CreateDefinitionInput
} from './definitions/types';

import { DefinitionFactory } from './definitions/factory';

// Singleton instances - created once and reused
let _definitionContainer: ReturnType<typeof DefinitionFactory.createContainer> | null = null;
let _definitionStore: ReturnType<typeof DefinitionFactory.createStore> | null = null;

/**
 * Get the definition container (singleton) - read-only
 */
export function getDefinitionContainer() {
	if (!_definitionContainer) {
		_definitionContainer = DefinitionFactory.createContainer();
	}
	return _definitionContainer;
}

/**
 * Get the definition store (singleton) - read + write
 */
export function getDefinitionStore() {
	if (!_definitionStore) {
		_definitionStore = DefinitionFactory.createStore();
	}
	return _definitionStore;
}

