import { ComputeConfig, RhinoModelUnit } from '@/core/types';

// ============================================================================
// GRASSHOPPER OUTPUT TYPES
// ============================================================================

/**
 * Output types supported from Grasshopper/Rhino Compute
 */
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
  | string;

/**
 * Raw output parameter schema from API (PascalCase format)
 *
 * Represents an output parameter as it comes from the Rhino Compute API.
 * Property names are in PascalCase.
 */
export interface RawParamOutputSchema {
  Name: string;
  Nickname: string | null;
  ParamType: string;
}

/**
 * Output parameter schema after conversion to camelCase
 *
 * Represents an output parameter after runtime conversion via camelcaseKeys().
 * Property names follow JavaScript conventions (camelCase).
 */
export interface ParamOutputSchema {
  name: string;
  nickname: string | null;
  paramType: string;
  paramId: string;
}

// ============================================================================
// DATA TREE STRUCTURES
// ============================================================================

/**
 * Grasshopper-style data tree branch path
 * @example "{0}", "{0;0}", "{0;1;2}"
 */
export type DataTreePath = `{${string}}`;

/**
 * Represents a data item in a data tree
 */
export interface DataItem {
  /** The type of the data, inferred from the Grasshopper GOO class */
  type: string;
  /** The actual returned data as a string that may need to be parsed */
  data: string;
  /** The grasshopper refrence id of the output */
  paramId: string;
}

/**
 * Grasshopper-style data tree for input defaults
 * @example
 * ```typescript
 * const numericTree: DataTreeDefault<number> = {
 *   "{0}": [1, 2, 3],
 *   "{0;0}": [4, 5],
 *   "{1}": [6]
 * };
 * ```
 */
export type DataTreeDefault<T = any> = {
  [K in DataTreePath]?: T[];
};

/**
 * Data structure for InnerTreeData matching Rhino Compute responses
 */
export type InnerTreeData = {
  [path in DataTreePath]: DataItem[];
};

/**
 * Inner tree with parameter metadata
 */
export interface InnerTree {
  InnerTree: InnerTreeData;
  ParamName: string;
}

/**
 * Data tree structure with append functionality
 */
export interface DataTree {
  data: {
    ParamName: string;
    InnerTree: InnerTreeData;
  };
  append: (path: number[], items: any[]) => void;
}

/**
 * Array of inner tree values
 */
export type Values = InnerTree[];

// ============================================================================
// INPUT PARAMETER TYPES
// ============================================================================

/**
 * Union type for all possible default value types
 */
export type DefaultValue<T> = T | T[] | DataTreeDefault<T> | undefined | null;

/**
 * Base properties common to all processed input types
 */
export interface BaseInputType {
  description: string;
  name: string;
  nickname: string | null;
  treeAccess: boolean;
  groupName: string;
  paramId: string;
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

export interface ValueListInputType extends BaseInputType {
  paramType: 'ValueList';
  values: Record<string, string>;
  default?: string;
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

/**
 * Raw input parameter schema from API (PascalCase format)
 *
 * This represents the raw input parameter as it comes from the Rhino Compute API.
 * All property names are in PascalCase, which is typical for .NET API responses.
 * This is converted to camelCase by the camelcaseKeys() function.
 */
export interface RawInputParamSchema {
  Description: string;
  Name: string;
  Nickname: string | null;
  TreeAccess: boolean;
  GroupName: string | null;
  ParamType: string;
  Minimum: number | null;
  Maximum: number | null;
  AtLeast: number;
  AtMost: number;
  StepSize?: number;
  Default: any;
}

/**
 * Input parameter schema after conversion to camelCase
 *
 * This represents an input parameter after runtime conversion via camelcaseKeys().
 * All property names follow JavaScript conventions (camelCase).
 */
export interface InputParamSchema {
  description: string;
  name: string;
  nickname: string | null;
  treeAccess: boolean;
  groupName: string | null;
  paramType: string;
  minimum: number | null;
  maximum: number | null;
  atLeast: number;
  atMost: number;
  stepSize?: number;
  default: any;
  values?: Record<string, string>;
  paramId: string;
}

/**
 * Grouped inputs by category
 */
export interface GroupInputs {
  [key: string]: {
    inputs: InputParam[];
  };
}

/**
 * Node in a nested group tree structure
 */
export interface NestedGroupNode {
  /** Display name of this group level */
  name: string;
  /** Full path to this node (e.g., "Layer_1::Layer_2") */
  path: string;
  /** Inputs that belong directly to this group level */
  inputs: InputParam[];
  /** Child group nodes */
  children: Map<string, NestedGroupNode>;
}

/**
 * Nested grouped inputs organized in a tree structure
 */
export interface NestedGroupInputs {
  [key: string]: NestedGroupNode;
}

// ============================================================================
// API RESPONSE SCHEMAS
// ============================================================================

/**
 * Raw I/O response schema from API (PascalCase)
 *
 * This is the direct response format from the Rhino Compute server API.
 * All property names are in PascalCase, which is typical for .NET APIs.
 * This raw response is converted to camelCase by the camelcaseKeys() function
 * in the fetchDefinitionIO() method.
 */
export interface IoResponseSchema {
  Description: string;
  FileName: string;
  CacheKey: string;
  InputNames: string[];
  OutputNames: string[];
  Icon: string | null;
  Inputs: RawInputParamSchema[];
  Outputs: RawParamOutputSchema[];
  Warnings: any[];
  Errors: any[];
}

/**
 * Converted API response schema (camelCase format)
 *
 * This is the shape of the I/O response AFTER runtime conversion via the
 * camelcaseKeys() function in the fetchDefinitionIO() method.
 *
 * All property names are converted from PascalCase to camelCase to follow
 * JavaScript conventions and maintain consistency with the rest of the codebase.
 *
 * Example transformation:
 * - Description -> description
 * - FileName -> fileName
 * - CacheKey -> cacheKey
 * - InputNames -> inputNames
 * - OutputNames -> outputNames
 * - Inputs -> inputs
 * - Outputs -> outputs
 * - Warnings -> warnings
 * - Errors -> errors
 *
 * @see {@link IoResponseSchema} for the raw API response format
 * @internal Do not use directly. This type is used internally for type annotations during conversion.
 */
export type CamelCasedIoResponseSchema = {
  description: string;
  fileName: string;
  cacheKey: string;
  inputNames: string[];
  outputNames: string[];
  icon: string | null;
  inputs: InputParamSchema[];
  outputs: ParamOutputSchema[];
  warnings: any[];
  errors: any[];
};

// ============================================================================
// PARSED DATA STRUCTURES
// ============================================================================

/**
 * Parsed input/output structure with raw schemas
 */
export interface GrasshopperParsedIORaw {
  inputs: InputParamSchema[];
  outputs: ParamOutputSchema[];
}

/**
 * Parsed input/output structure with processed types
 */
export interface GrasshopperParsedIO {
  inputs: InputParam[];
  outputs: ParamOutputSchema[];
}

// /**
//  * Result structure from Grasshopper computation
//  */
// export interface GrasshopperParsedResult {
//   data?: Record<string, any[]>;
//   rawResponse?: GrasshopperComputeResponse;
//   message?: string;
//   [key: string]: any;
// }

// ============================================================================
// BASE GRASSHOPPER SCHEMA
// ============================================================================

/**
 * Base Grasshopper schema properties shared by config, args, and response
 */
export interface GrasshopperBaseSchema {
  /** Absolute tolerance used in computation */
  absolutetolerance?: number | null;
  /** Angular tolerance used in computation */
  angletolerance?: number | null;
  /** Model units used */
  modelunits?: RhinoModelUnit | null;
  /** Data version (7 or 8) */
  dataversion?: 7 | 8 | null;
  /** Whether to use cached solution */
  cachesolve?: boolean | null;
}

/**
 * Definition source (used in args and response)
 */
export interface GrasshopperDefinitionSource {
  /** Base64 encoded algorithm (if embedded) */
  algo?: string | null;
  /** URL pointer to definition file */
  pointer?: string | null;
  /** Filename of the definition */
  filename?: string | null;
}

// ============================================================================
// COMPUTE CONFIGURATION (User-facing config)
// ============================================================================

/**
 * Configuration for Grasshopper compute operations
 * Extends base config with Grasshopper-specific options
 */
export interface GrasshopperComputeConfig
  extends ComputeConfig,
  GrasshopperBaseSchema,
  GrasshopperDefinitionSource { }

// ============================================================================
// COMPUTE ARGUMENTS (Request payload)
// ============================================================================

/**
 * Arguments sent to Grasshopper compute endpoint
 * Includes config options + definition source + input values
 */
export interface GrasshopperRequestSchema
  extends GrasshopperBaseSchema,
  GrasshopperDefinitionSource {
  /** Input values organized by parameter */
  values?: InnerTree[];
}

// ============================================================================
// COMPUTE RESPONSE (Server response)
// ============================================================================

/**
 * Response from Grasshopper compute server
 * Includes all schema fields + computed results
 */
export interface GrasshopperComputeResponse
  extends GrasshopperBaseSchema,
  GrasshopperDefinitionSource {
  /** Whether cache was used (always present in response) */
  cachesolve: boolean;
  /** Model units (always present in response) */
  modelunits: RhinoModelUnit;
  /** Base64 encoded algorithm (always present in response) */
  algo: string;
  /** Filename of the definition (always present in response) */
  filename: string | null;
  /** Data version */
  dataversion: 7 | 8;
  /** Recursion level used */
  recursionlevel?: number;
  /** Output values organized by parameter */
  values: InnerTree[];
  /** Computation errors */
  errors?: string[];
  /** Computation warnings */
  warnings?: string[];
}
export interface ProcessedDataItem {
  type: string;
  data: any;
  path: string;
}
