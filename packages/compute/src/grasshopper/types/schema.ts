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
}

/**
 * Where a Selva-family plugin running inside the solve may POST live events, and
 * the bearer it presents. The VektorNode fork hands these to the document as
 * constants; a stock server ignores the block. Never echoed in the response.
 */
export interface SelvaEventTarget {
	url: string;
	solveId: string;
	token: string;
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
 * Server config plus the Grasshopper solve settings. The definition is not part
 * of it: pass that to `solve()` and friends.
 */
export interface GrasshopperComputeConfig extends ComputeConfig, GrasshopperBaseSchema {
	/** Per-solve live-event callback; see {@link SelvaEventTarget}. */
	selvaevents?: SelvaEventTarget | null;
}

/**
 * Arguments sent to Grasshopper compute endpoint
 * Includes config options + definition source + input values
 */
export interface GrasshopperRequestSchema
	extends GrasshopperBaseSchema, GrasshopperDefinitionSource {
	/** Input values organized by parameter */
	values?: DataTree[];
	/** Per-solve live-event callback; see {@link SelvaEventTarget}. */
	selvaevents?: SelvaEventTarget | null;
}

/**
 * Response from Grasshopper compute server.
 *
 * No `pointer`: the solve returns the server's echoed pointer as its `cacheKey`
 * instead. The echoed settings (`cachesolve`, `dataversion`) stay optional:
 * nothing client-side enforces them.
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
	/** Always `undefined` on a client-returned response: the solve strips it. */
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
	/** Set by the VektorNode fork when a Selva plugin judged the solve; see {@link SelvaResponseBlock}. */
	selva?: SelvaResponseBlock | null;
}

/**
 * The Selva plugin's verdict on a solve, which the VektorNode fork copies verbatim into the
 * response. `outcome` is `SolveOutcome` from `@selvajs/schemas`, typed loosely here because
 * this package does not depend on it. A blocked or aborted outcome comes with empty `values`.
 * Absent from a stock server, an older plugin, or a definition without a Selva component.
 */
export interface SelvaResponseBlock {
	outcome?: unknown;
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
