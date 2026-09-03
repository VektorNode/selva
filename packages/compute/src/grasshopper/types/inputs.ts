// Data tree and input parameter types.

// DATA TREE TYPES

// Grasshopper-style data tree branch path: e.g. "{0}", "{0;0}", "{0;1;2}"
export type DataTreePath = `{${string}}`;

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
 * Field casing varies by server branch: stock mcneel compute (8.x/9.x)
 * serializes `Resthopper.IO.DataTree` in PascalCase (`ParamName`/`InnerTree`
 * (the C# class carries no `[JsonProperty]` attributes), while
 * camelCase-serializing forks return `paramName`/`innerTree` instead. This
 * client always *sends* PascalCase (see `DataTree.toCompute()` in
 * `data-tree.ts`), so the PascalCase fields remain the canonical/required
 * shape; the optional camelCase fields exist so responses from camelCase
 * forks are representable without casts. Code that must read trees across
 * both server families should use `readField`/`hasField`
 * (`@/core/utils/read-field`, case-insensitive) rather than direct property
 * access; `warnOnEmptyInnerTrees` in `solve.ts` is the reference example.
 */
export interface DataTree {
	/** PascalCase: stock mcneel servers, and the request shape this client sends. */
	InnerTree: InnerTreeData;
	/** PascalCase: stock mcneel servers, and the request shape this client sends. */
	ParamName: string;
	/** camelCase: sent instead of `InnerTree` by camelCase server forks. */
	innerTree?: InnerTreeData;
	/** camelCase: sent instead of `ParamName` by camelCase server forks. */
	paramName?: string;
}

// INPUT / OUTPUT PARAMETER TYPES

// Output types from Grasshopper/Rhino Compute.
// `(string & {})` keeps union open for unknown GOO types while preserving autocomplete.
export type OutputType =
	| 'System.String'
	| 'System.Double'
	| 'System.Int32'
	| 'System.Boolean'
	| 'Rhino.Geometry.Point3d'
	| 'Rhino.Geometry.Line'
	| 'Rhino.Geometry.Circle'
	| 'Rhino.Geometry.Arc'
	| 'Rhino.Geometry.NurbsCurve'
	| 'Rhino.Geometry.Brep'
	| 'Rhino.Geometry.Mesh'
	| 'Rhino.Geometry.Vector3d'
	| 'Rhino.Geometry.Plane'
	| 'Rhino.Geometry.Box'
	| (string & {});

export type DefaultValue<T> = T | T[] | DataTreeDefault<T> | undefined | null;

// Base properties common to all processed input types.
export interface BaseInputType {
	description: string;
	name: string;
	nickname: string | null;
	treeAccess: boolean;

	/** @requires Custom branch of compute.rhino3d */
	groupName?: string;

	/** @requires Custom branch of compute.rhino3d */
	id?: string;
}

export interface NumericInputType extends BaseInputType {
	paramType: 'Number' | 'Integer';
	minimum?: number | null;
	maximum?: number | null;
	atLeast?: number | null;
	atMost?: number | null;
	stepSize?: number | null;
	default: DefaultValue<number>;
}

export interface TextInputType extends BaseInputType {
	paramType: 'Text';
	default: DefaultValue<string>;
}

export interface BooleanInputType extends BaseInputType {
	paramType: 'Boolean';
	default: DefaultValue<boolean>;
}

export interface GeometryInputType extends BaseInputType {
	paramType: 'Geometry';
	default: DefaultValue<object | string>;
}

// ValueList input type (dropdown/select)
export interface ValueListInputType extends BaseInputType {
	paramType: 'ValueList';
	values: Record<string, string>;
	default?: string;
}

export interface FileInputType extends BaseInputType {
	paramType: 'File';
	acceptedFormats?: string[];
	default: DefaultValue<object | string>;
}

// Color input type, stored as a hex string.
export interface ColorInputType extends BaseInputType {
	paramType: 'Color';
	default: DefaultValue<string>;
}

// Discriminated union of all input parameter types.
export type InputParam =
	| NumericInputType
	| BooleanInputType
	| TextInputType
	| ValueListInputType
	| GeometryInputType
	| FileInputType
	| ColorInputType;
