// Parsed input/output structures returned by the IO layer.

import type { InputParam } from './inputs';

import type { InputParamSchema, OutputParamSchema } from './schema';

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
	/** Human-readable reason from the underlying ComputeError. */
	message: string;
	/** Error code from the underlying ComputeError, if available. */
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
