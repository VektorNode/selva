// Rhino Compute API request/response schema types.

import type { ComputeConfig } from '@/core/types';

import type { DataTree } from './inputs';

// Rhino model unit types supported by Rhino.Compute
export type RhinoModelUnit =
	| 'None'
	| 'Microns'
	| 'Millimeters'
	| 'Centimeters'
	| 'Decimeters'
	| 'Meters'
	| 'Kilometers'
	| 'Mils'
	| 'Inches'
	| 'Feet'
	| 'Yards'
	| 'Miles'
	| 'CustomUnits'
	| 'Unset';

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
