// Parsed input/output structures returned by the IO layer.

import type { InputParam } from './inputs';

import type { InputParamSchema, OutputParamSchema } from './schema';

/** Input/output schemas as the `/io` endpoint reports them, keys canonicalized. */
export interface GrasshopperParsedIORaw {
	inputs: InputParamSchema[];
	outputs: OutputParamSchema[];
	/**
	 * Warnings the server raised loading the definition (e.g. an obsolete
	 * component). Distinct from `parseErrors`, the client failing to type an input.
	 */
	loadWarnings?: string[];
	/**
	 * Errors the server raised loading the definition (e.g. a missing plugin).
	 * When present, `inputs`/`outputs` may be incomplete.
	 */
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
	/** Human-readable reason from the underlying ComputeError. */
	message: string;
	/** Error code from the underlying ComputeError, if available. */
	code?: string;
}

/** {@link GrasshopperParsedIORaw} with each input parsed into its typed {@link InputParam}. */
export interface GrasshopperParsedIO extends Omit<GrasshopperParsedIORaw, 'inputs'> {
	inputs: InputParam[];
	/**
	 * Inputs that failed validation and got a safe default. The result is still
	 * usable, but surface these so the user can fix their definition.
	 */
	parseErrors?: InputParseError[];
}
