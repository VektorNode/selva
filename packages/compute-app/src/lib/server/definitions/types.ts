/**
 * Core interfaces for definition loading - decoupled from implementation
 */

export type DefinitionFileType = 'gh' | 'ghx';

export interface DefinitionMetadata {
	displayName: string;
	description?: string;
	coverImage?: string;
	category?: string;
	tags?: string[];
}

export interface Definition extends DefinitionMetadata {
	filename: string;
	fileType: DefinitionFileType;
}

export interface IDefinitionLoader {
	/**
	 * Get all available definitions
	 */
	listDefinitions(): Promise<Definition[]>;

	/**
	 * Get metadata for a specific definition
	 */
	getMetadata(filename: string): Promise<DefinitionMetadata>;

	/**
	 * Load a definition file as binary data
	 */
	loadDefinition(filename: string): Promise<Uint8Array>;

	/**
	 * Get a URL for a definition (may be local path or remote URL)
	 */
	getDefinitionUrl(filename: string): Promise<string>;
}

export interface DefinitionsConfig {
	definitions: Record<string, DefinitionMetadata>;
}
