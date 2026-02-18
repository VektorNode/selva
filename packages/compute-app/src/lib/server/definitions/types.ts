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
	/** Filename of the active .gh/.ghx file inside the GUID folder */
	file?: string;
}

export interface Definition extends DefinitionMetadata {
	/** The GUID - config key and folder name */
	guid: string;
	/** Same as `file` field - the active filename */
	filename: string;
	fileType: DefinitionFileType;
}

export interface IDefinitionLoader {
	/**
	 * Get all available definitions
	 */
	listDefinitions(): Promise<Definition[]>;

	/**
	 * Get metadata for a specific definition.
	 * @param identifier - GUID or filename (e.g. "table_example.gh")
	 */
	getMetadata(identifier: string): Promise<DefinitionMetadata>;

	/**
	 * Load a definition file as binary data.
	 * @param identifier - GUID or filename
	 */
	loadDefinition(identifier: string): Promise<Uint8Array>;

	/**
	 * Get a URL for a definition (may be local path or remote URL).
	 * @param identifier - GUID or filename
	 */
	getDefinitionUrl(identifier: string): Promise<string>;
}

export interface DefinitionsConfig {
	definitions: Record<string, DefinitionMetadata>;
}
