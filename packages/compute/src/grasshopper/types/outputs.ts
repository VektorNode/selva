// Parsed input/output structures returned by the IO layer.

import type { InputParam } from './inputs';

import type { InputParamSchema, OutputParamSchema } from './schema';

/**
 * Parsed input/output structure with raw schemas.
 *
 * `loadWarnings` / `loadErrors` are the server's definition-load diagnostics
 * from the `/io` response (missing plugin, broken component). Distinct from
 * per-input parse failures (`InputParseError`): these come from the server
 * loading the definition, those from the client typing an input.
 */
export interface GrasshopperParsedIORaw {
	inputs: InputParamSchema[];
	outputs: OutputParamSchema[];
	loadWarnings?: string[];
	/** e.g. missing plugin. */
	loadErrors?: string[];
}

/**
 * Per-input parse failure. The corresponding entry in `inputs` was filled
 * with a safe default so the pipeline can keep going, but the caller should
 * surface this so the user knows their definition has a misconfigured
 * parameter.
 */
export interface InputParseError {
	/** The input's `name`, or `'unknown'` if the schema didn't have one. */
	inputName: string;
	paramType: string;
	/** Human-readable reason from the underlying ComputeError. */
	message: string;
	/** Error code from the underlying ComputeError, if available. */
	code?: string;
}

/**
 * Parsed input/output structure with processed types.
 *
 * `parseErrors` is populated when one or more inputs failed validation and
 * fell back to a safe default; the result is still usable but the UI should
 * surface these so the user can fix their definition. `loadWarnings` /
 * `loadErrors` carry the same server-side diagnostics as
 * {@link GrasshopperParsedIORaw} and are distinct from `parseErrors`
 * (client-side input typing failures): a present `loadErrors` means the
 * inputs/outputs list itself may be incomplete.
 */
export interface GrasshopperParsedIO {
	inputs: InputParam[];
	outputs: OutputParamSchema[];
	parseErrors?: InputParseError[];
	loadWarnings?: string[];
	loadErrors?: string[];
}
