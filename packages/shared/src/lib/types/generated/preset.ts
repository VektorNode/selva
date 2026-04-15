/**
 * This file was automatically generated from schemas/preset-schema.json.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,
 * and run `npm run generate:ts` in the schemas directory to regenerate this file.
 */

/**
 * Schema for saved parameter states (presets) for Selva Grasshopper documents
 */
export interface SelvaParameterPresetSchema {
	[k: string]: unknown | undefined;
}
export interface ParameterState {
	/**
	 * Parameter GUID - primary reference
	 */
	paramId: string;
	/**
	 * Parameter nickname for validation
	 */
	nickname: string;
	/**
	 * Display name for validation
	 */
	displayName?: string;
	/**
	 * Parameter type for validation
	 */
	paramType: string;
	value: unknown;
	/**
	 * Group name for validation (optional)
	 */
	groupName?: string;
}
export interface ParameterPreset {
	/**
	 * Unique identifier for this preset
	 */
	id: string;
	/**
	 * User-friendly preset name
	 */
	name: string;
	/**
	 * Optional description of this preset
	 */
	description?: string;
	/**
	 * When this preset was saved
	 */
	timestamp: string;
	/**
	 * References UISchema.id
	 */
	schemaId: string;
	/**
	 * Must match UISchema.documentId for validation
	 */
	documentId: string;
	/**
	 * Document file name for reference
	 */
	projectFileName?: string;
	/**
	 * Plugin version when preset was saved
	 */
	pluginVersion?: string;
	/**
	 * Who saved this preset
	 */
	author?: string;
	/**
	 * Tags for organizing presets
	 */
	tags?: string[];
	/**
	 * All parameter values
	 */
	parameters: ParameterState[];
}
