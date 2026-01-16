import type { IDefinitionLoader, Definition, DefinitionMetadata } from './types';

/**
 * Definition container - provides unified interface to the loader
 * Encapsulates the definition loading logic
 */
export class DefinitionContainer {
	constructor(private loader: IDefinitionLoader) {}

	/**
	 * Get all available definitions
	 */
	async listDefinitions(): Promise<Definition[]> {
		return this.loader.listDefinitions();
	}

	/**
	 * Get metadata for a specific definition
	 */
	async getMetadata(filename: string): Promise<DefinitionMetadata> {
		return this.loader.getMetadata(filename);
	}

	/**
	 * Load a definition file as binary data
	 */
	async loadDefinition(filename: string): Promise<Uint8Array> {
		return this.loader.loadDefinition(filename);
	}

	/**
	 * Get a URL for a definition (may be local path or remote URL)
	 */
	async getDefinitionUrl(filename: string): Promise<string> {
		return this.loader.getDefinitionUrl(filename);
	}

	/**
	 * Get a definition by filename, including metadata
	 */
	async getDefinition(filename: string): Promise<Definition> {
		const definitions = await this.listDefinitions();
		const definition = definitions.find((d) => d.filename === filename);

		if (!definition) {
			throw new Error(`Definition '${filename}' not found`);
		}

		return definition;
	}

	/**
	 * Get the first available definition (useful for auto-loading)
	 */
	async getFirstDefinition(): Promise<Definition | null> {
		const definitions = await this.listDefinitions();
		return definitions[0] || null;
	}
}
