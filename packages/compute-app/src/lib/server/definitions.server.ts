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
import { DefinitionContainer } from './definitions/container';

// Single store instance — the store extends the loader, so both the
// container and store share the same cache and file watcher.
let _definitionStore: ReturnType<typeof DefinitionFactory.createStore> | null = null;
let _definitionContainer: DefinitionContainer | null = null;

function getStore() {
	if (!_definitionStore) {
		_definitionStore = DefinitionFactory.createStore();
	}
	return _definitionStore;
}

/**
 * Get the definition container (singleton) - read-only
 */
export function getDefinitionContainer() {
	if (!_definitionContainer) {
		_definitionContainer = new DefinitionContainer(getStore());
	}
	return _definitionContainer;
}

/**
 * Get the definition store (singleton) - read + write
 */
export function getDefinitionStore() {
	return getStore();
}

