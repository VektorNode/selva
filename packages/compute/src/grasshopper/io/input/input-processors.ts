import { ComputeError } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';

import { normalizeDefaultWithWarning } from './normalize-default';
import { INPUT_TYPE_PARSERS, UNKNOWN_TYPE_FALLBACK } from './input-type-parsers';

import type { BaseInputType, InputParam, InputParamSchema, InputParseError } from '../../types';

/** Canonical paramType for each supported type, keyed by its lowercased form. */
const CANONICAL_PARAM_TYPES = new Map(
	[...INPUT_TYPE_PARSERS.keys()].map((key) => [key.toLowerCase(), key])
);

/**
 * Returns the canonical casing for a paramType (e.g. "valuelist" → "ValueList"),
 * or the original value unchanged when it isn't a known type so the
 * unknown-paramType error still surfaces downstream.
 */
function canonicalizeParamType(paramType: string): string {
	return CANONICAL_PARAM_TYPES.get(paramType?.toLowerCase()) ?? paramType;
}

/**
 * Parse one raw Grasshopper input schema into a typed {@link InputParam}.
 * Validation failures are swallowed and replaced with a safe default; use
 * {@link processInputWithError} to receive them.
 */
export function processInput(rawInput: InputParamSchema): InputParam {
	return processInputWithError(rawInput).input;
}

/**
 * Like {@link processInput}, but reports validation failures back to the caller
 * instead of swallowing them with a logger warning.
 *
 * On success: `{ input, error: undefined }`.
 * On a recoverable validation failure: `{ input: <safe default>, error: {...} }`.
 *
 * A single input can report several entries — a malformed default
 * (normalization warning), warnings the type parser recovered from (e.g. a
 * ValueList default not in its values map), and a parser error. `errors`
 * carries every one; `error` remains the primary one (the parser error when
 * present, else the default warning) for convenience.
 *
 * Error entries report the RAW declared `paramType` per the
 * {@link InputParseError} docs — not the canonicalized casing — so clients can
 * match on the casing they sent.
 *
 * Unexpected (non-ComputeError) failures still throw — they indicate a
 * programming bug, not bad user input.
 *
 * @internal Used by {@link processInputsWithErrors} / {@link fetchParsedDefinitionIO}.
 */
export function processInputWithError(rawInput: InputParamSchema): {
	input: InputParam;
	error?: InputParseError;
	errors?: InputParseError[];
} {
	const baseInput: BaseInputType = {
		description: rawInput.description,
		name: rawInput.name,
		nickname: rawInput.nickname,
		treeAccess: rawInput.treeAccess,
		// `null`/absent means "no group" — keep it absent instead of collapsing it
		// to '' and erasing the absent-vs-empty distinction.
		groupName: rawInput.groupName ?? undefined,
		id: rawInput.id
	};

	// Normalize paramType to its canonical casing so callers can send any case
	// (e.g. Selva schemas emit lowercase "valueList" while the plugin reports
	// "ValueList"). The registry is keyed by canonical type.
	const paramType = canonicalizeParamType(rawInput.paramType);

	// Shared, type-independent step: flatten the raw innerTree default into the
	// shape the per-type parsers expect (pure — does not mutate rawInput). An
	// unrecognized default shape nulls the value AND returns a warning so the
	// drop is surfaced to the client via parseErrors instead of vanishing.
	let schema: InputParamSchema = { ...rawInput, paramType };
	let defaultWarningError: InputParseError | undefined;
	try {
		const { schema: normalized, warning } = normalizeDefaultWithWarning(schema);
		schema = normalized;
		defaultWarningError = warning && {
			inputName: rawInput.name || 'unknown',
			// InputParseError.paramType is documented as the RAW declared type.
			paramType: rawInput.paramType,
			message: warning.message,
			code: warning.code
		};
	} catch (error) {
		// A default too malformed for the normalizer to even walk is bad server/user data, not a
		// programming bug — null it and report per-input rather than aborting the whole
		// definition-IO fetch over one input.
		schema = { ...schema, default: null };
		defaultWarningError = {
			inputName: rawInput.name || 'unknown',
			paramType: rawInput.paramType,
			message: `Input "${rawInput.name ?? 'unknown'}" default could not be normalized and was dropped: ${
				error instanceof Error ? error.message : String(error)
			}`,
			code: 'MALFORMED_DEFAULT'
		};
	}
	const parser = INPUT_TYPE_PARSERS.get(paramType);

	// Recoverable oddities a parser reports while still succeeding (e.g. a
	// ValueList default not in its values map) — surfaced like default warnings.
	const parserWarnings: InputParseError[] = [];
	const warn = (warning: { code: string; message: string }) =>
		parserWarnings.push({
			inputName: rawInput.name || 'unknown',
			paramType: rawInput.paramType,
			message: warning.message,
			code: warning.code
		});

	try {
		if (!parser) {
			throw ComputeError.unknownParamType(paramType, rawInput.name);
		}
		// Malformed-default and parser warnings ride through on the
		// otherwise-successful parse.
		const input = parser.parse(schema, baseInput, warn);
		const warnings = defaultWarningError
			? [defaultWarningError, ...parserWarnings]
			: parserWarnings;
		return {
			input,
			error: defaultWarningError,
			...(warnings.length > 0 && { errors: warnings })
		};
	} catch (error) {
		if (error instanceof ComputeError) {
			getLogger().error(`Validation error for input ${rawInput.name || 'unknown'}:`, error.message);
			const parserError: InputParseError = {
				inputName: rawInput.name || 'unknown',
				paramType: rawInput.paramType,
				message: error.message,
				code: error.code
			};
			// The parser owns its own fallback; an unknown type falls back to the
			// geometry-shaped safe default (matching the old behavior). EVERY
			// failure is reported when the default warning, parser warnings, and
			// the parser error occurred on the same input — none may be shadowed.
			return {
				input: (parser ?? UNKNOWN_TYPE_FALLBACK).fallback(schema, baseInput),
				error: parserError,
				errors: [
					...(defaultWarningError ? [defaultWarningError] : []),
					...parserWarnings,
					parserError
				]
			};
		}

		// Unexpected failure — surface it.
		throw new ComputeError(
			error instanceof Error ? error.message : String(error),
			'VALIDATION_ERROR',
			{
				context: { paramName: rawInput.name, paramType },
				originalError: error instanceof Error ? error : new Error(String(error))
			}
		);
	}
}

/**
 * Parse an array of raw input schemas into typed {@link InputParam}s, each via
 * {@link processInput}. Use {@link processInputsWithErrors} to also collect the
 * inputs that failed validation.
 */
export function processInputs(rawInputs: InputParamSchema[]): InputParam[] {
	return processInputsWithErrors(rawInputs).inputs;
}

/**
 * Like {@link processInputs}, but additionally returns a list of inputs that
 * failed validation and were filled with a safe default.
 *
 * @internal Used by {@link fetchParsedDefinitionIO}.
 */
export function processInputsWithErrors(rawInputs: InputParamSchema[]): {
	inputs: InputParam[];
	parseErrors: InputParseError[];
} {
	const inputs: InputParam[] = [];
	const parseErrors: InputParseError[] = [];
	for (const raw of rawInputs) {
		const { input, errors } = processInputWithError(raw);
		inputs.push(input);
		if (errors) parseErrors.push(...errors);
	}
	return { inputs, parseErrors };
}
