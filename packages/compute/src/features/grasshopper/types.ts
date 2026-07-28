// Grasshopper types

import type { ComputeConfig, RhinoModelUnit } from '@/core/types';

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
 * Field casing varies by server branch: stock mcneel compute (8.x/9.x)
 * serializes `Resthopper.IO.DataTree` in PascalCase (`ParamName`/`InnerTree`
 * — the C# class carries no `[JsonProperty]` attributes), while
 * camelCase-serializing forks return `paramName`/`innerTree` instead. This
 * client always *sends* PascalCase (see `DataTree.toCompute()` in
 * `data-tree.ts`), so the PascalCase fields remain the canonical/required
 * shape; the optional camelCase fields exist so responses from camelCase
 * forks are representable without casts. Code that must read trees across
 * both server families should use `readField`/`hasField`
 * (`@/core/utils/read-field`, case-insensitive) rather than direct property
 * access — `warnOnEmptyInnerTrees` in `solve.ts` is the reference example.
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
 * Color input type (stored as hex string)
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

// ============================================================================
// API SCHEMA TYPES
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
	/**
	 * Opt-in: cache a solve even when the definition reported GH errors. Default
	 * (false/unset) means errored solves are never cached server-side. Some
	 * definitions throw GH errors by design (a guarded Python component, a
	 * filtered branch) while still producing correct geometry — set this so those
	 * still benefit from the server's solve cache. Only meaningful with
	 * `cachesolve`. Requires a server that honors it (VektorNode fork).
	 */
	cacheerroredsolves?: boolean | null;
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

/**
 * Configuration for Grasshopper compute operations
 * Combines server config with optional Grasshopper-specific computation settings
 *
 * Note: The definition source (pointer/algo) is NOT part of config.
 * Instead, pass the definition directly to methods like solve(), getIO(), etc.
 */
export interface GrasshopperComputeConfig extends ComputeConfig {
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
	/**
	 * Opt-in: cache a solve even when the definition reported GH errors. See
	 * {@link GrasshopperBaseSchema.cacheerroredsolves}. Only meaningful with
	 * `cachesolve`.
	 */
	cacheerroredsolves?: boolean | null;
}

/**
 * Raw I/O response schema as returned by the `/io` endpoint.
 *
 * The VektorNode/compute.rhino3d@Compute8 server fork standardized IO
 * serialization to camelCase (`[JsonProperty("paramType")]` etc.), so this is
 * already the on-the-wire shape. Note that `fetchDefinitionIO` still normalizes
 * the payload before returning it (PascalCase fallbacks for stock mcneel
 * servers, array guards, diagnostics coercion) — see `normalizeInputSchema` /
 * `normalizeOutputSchema`. The field+casing contract is pinned against the
 * server source in `tests/contract/server-contract.test.ts`.
 */
export interface IoResponseSchema {
	description: string;
	filename: string;
	cachekey: string;
	inputnames: string[];
	outputnames: string[];
	icon: string | null;
	inputs: InputParamSchema[];
	outputs: OutputParamSchema[];
	warnings: any[];
	errors: any[];
}

/**
 * Arguments sent to Grasshopper compute endpoint
 * Includes config options + definition source + input values
 */
export interface GrasshopperRequestSchema
	extends GrasshopperBaseSchema, GrasshopperDefinitionSource {
	/** Input values organized by parameter */
	values?: DataTree[];
}

/**
 * Response from Grasshopper compute server
 * Includes all schema fields + computed results
 *
 * `pointer` is deliberately excluded (`Omit`): the solve layer (`runSolve` in
 * `solve.ts`) splits the server's echoed `pointer` off as the solve's
 * `cacheKey` and strips it from the returned response, so client-returned
 * responses never carry it.
 *
 * The schema-echo fields (`cachesolve`/`modelunits`/`dataversion`) stay
 * optional as inherited from {@link GrasshopperBaseSchema}: the server echoes
 * them back when set, but nothing client-side enforces their presence — don't
 * rely on them without a fallback.
 */
export interface GrasshopperComputeResponse
	extends GrasshopperBaseSchema, Omit<GrasshopperDefinitionSource, 'pointer'> {
	/**
	 * Model units the definition was solved in. Every conforming server response
	 * carries this (it drives downstream scaling, e.g. the webdisplay parser),
	 * but note it is not validated client-side — a non-conforming server or
	 * hand-built mock may omit it at runtime.
	 */
	modelunits: RhinoModelUnit;
	/**
	 * The server echoes the request's full base64 definition back as `algo`, but the client strips
	 * it before returning — retaining it would pin a multi-MB copy of the definition per response,
	 * multiplied by every cache that holds responses. Always `undefined` on client-returned
	 * responses (inherited optional field from {@link GrasshopperDefinitionSource}).
	 */
	algo?: string | null;
	/** Filename of the definition (always present in response) */
	filename: string | null;
	/** Recursion level used */
	recursionlevel?: number;
	/** Output values organized by parameter */
	values: DataTree[];
	/** Computation errors */
	errors?: string[];
	/** Computation warnings */
	warnings?: string[];
}

/**
 * Output parameter
 */
export interface OutputParamSchema {
	name: string;
	nickname: string | null;
	paramType: string;
	/**
	 * Grasshopper parameter instance GUID
	 */
	id: string;
}

/**
 * Input parameter
 */
export interface InputParamSchema {
	/**
	 * Grasshopper parameter instance GUID
	 */
	id: string;
	name: string;
	nickname: string | null;
	description: string;
	paramType: string;
	treeAccess: boolean;
	minimum: number | null;
	maximum: number | null;
	atLeast: number;
	atMost: number;
	stepSize?: number;
	default: any;
	/**
	 * Key-value pairs for dropdown options
	 */
	values?: Record<string, string>;
	/**
	 * Accepted file formats for File input
	 */
	acceptedFormats?: string[];
	groupName?: string | null;
}

// ============================================================================
// PARSED TYPES
// ============================================================================

/**
 * Parsed input/output structure with raw schemas.
 *
 * `loadWarnings` / `loadErrors` carry the server's definition-load diagnostics
 * (missing plugin, broken component, etc.) from the `/io` response. They are
 * distinct from per-input parse failures (`InputParseError`): these come from
 * the server loading the definition, those from the client typing an input.
 */
export interface GrasshopperParsedIORaw {
	inputs: InputParamSchema[];
	outputs: OutputParamSchema[];
	/** Server-side definition-load warnings, if any. */
	loadWarnings?: string[];
	/** Server-side definition-load errors, if any (e.g. missing plugin). */
	loadErrors?: string[];
}

/**
 * Per-input parse failure. The corresponding entry in `inputs` was filled
 * with a safe default so the rest of the pipeline can keep going — but the
 * caller should surface this so the user knows their definition has a
 * misconfigured parameter.
 */
export interface InputParseError {
	/** The input's `name` (or `'unknown'` if the schema didn't have one). */
	inputName: string;
	/** The declared paramType from the raw schema. */
	paramType: string;
	/** Human-readable reason from the underlying RhinoComputeError. */
	message: string;
	/** Error code from the underlying RhinoComputeError, if available. */
	code?: string;
}

/**
 * Parsed input/output structure with processed types.
 *
 * `parseErrors` is populated when one or more inputs failed validation and
 * fell back to a safe default. The result is still usable, but the UI should
 * surface these so the user can fix their definition.
 */
export interface GrasshopperParsedIO {
	inputs: InputParam[];
	outputs: OutputParamSchema[];
	parseErrors?: InputParseError[];
	/**
	 * Server-side definition-load warnings from the `/io` response (e.g. an
	 * obsolete component). Surface these so the user understands a degraded IO
	 * list. Distinct from `parseErrors` (client-side input typing failures).
	 */
	loadWarnings?: string[];
	/**
	 * Server-side definition-load errors from the `/io` response (e.g. a missing
	 * plugin that left inputs unresolved). When present, the inputs/outputs may
	 * be incomplete — the user needs to fix their server/definition.
	 */
	loadErrors?: string[];
}
