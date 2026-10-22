// Data tree and input parameter types.

// DATA TREE TYPES

// Grasshopper-style data tree branch path: e.g. "{0}", "{0;0}", "{0;1;2}"
export type DataTreePath = `{${string}}`;

// Represents a data item in a data tree
export interface DataItem {
	type: string;
	data: string;
	id: string;
}

// Grasshopper-style data tree for input defaults: { "{0}": [1, 2, 3], "{0;0}": [4, 5] }
export type DataTreeDefault<T = any> = {
	[K in DataTreePath]?: T[];
};

// Data structure matching Rhino Compute responses
export type InnerTreeData = {
	[path in DataTreePath]: DataItem[];
};

/**
 * Tree with parameter metadata (used in compute requests and responses).
 *
 * This client sends PascalCase (`TreeBuilder.toComputeFormat()`), so those
 * fields are required; a response's casing varies by server branch, so read
 * one with `readField` rather than by property.
 */
export interface DataTree {
	/** PascalCase — stock mcneel servers, and the request shape this client sends. */
	InnerTree: InnerTreeData;
	/** PascalCase — stock mcneel servers, and the request shape this client sends. */
	ParamName: string;
	/** camelCase — sent instead of `InnerTree` by camelCase server forks. */
	innerTree?: InnerTreeData;
	/** camelCase — sent instead of `ParamName` by camelCase server forks. */
	paramName?: string;
}

// INPUT / OUTPUT PARAMETER TYPES

/**
 * Union type for all possible default value types
 */
export type DefaultValue<T> = T | T[] | DataTreeDefault<T> | undefined | null;

/**
 * Base properties common to all processed input types.
 * Note: `groupName` and `id` require the custom Rhino Compute branch.
 */
export interface BaseInputType {
	description: string;
	name: string;
	nickname: string | null;
	treeAccess: boolean;

	/**
	 * Name of the group this parameter belongs to.
	 * @requires Custom branch of compute.rhino3d
	 */
	groupName?: string;

	/**
	 * Unique identifier for the parameter.
	 * @requires Custom branch of compute.rhino3d
	 */
	id?: string;
}

/**
 * Numeric input type (Number or Integer)
 */
export interface NumericInputType extends BaseInputType {
	paramType: 'Number' | 'Integer';
	minimum?: number | null;
	maximum?: number | null;
	atLeast?: number | null;
	atMost?: number | null;
	stepSize?: number | null;
	default: DefaultValue<number>;
}

/**
 * Text input type
 */
export interface TextInputType extends BaseInputType {
	paramType: 'Text';
	default: DefaultValue<string>;
}

/**
 * Boolean input type
 */
export interface BooleanInputType extends BaseInputType {
	paramType: 'Boolean';
	default: DefaultValue<boolean>;
}

/**
 * Geometry input type (generic geometry)
 */
export interface GeometryInputType extends BaseInputType {
	paramType: 'Geometry';
	default: DefaultValue<object | string>;
}

/**
 * ValueList input type (dropdown/select)
 */
export interface ValueListInputType extends BaseInputType {
	paramType: 'ValueList';
	values: Record<string, string>;
	default?: string;
}

/**
 * File input type
 */
export interface FileInputType extends BaseInputType {
	paramType: 'File';
	acceptedFormats?: string[];
	default: DefaultValue<object | string>;
}

/**
 * Color input type. Values are `"R, G, B"` strings (`"255, 0, 0"`), not hex.
 */
export interface ColorInputType extends BaseInputType {
	paramType: 'Color';
	default: DefaultValue<string>;
}

/**
 * Discriminated union of all input parameter types
 */
export type InputParam =
	| NumericInputType
	| BooleanInputType
	| TextInputType
	| ValueListInputType
	| GeometryInputType
	| FileInputType
	| ColorInputType;
