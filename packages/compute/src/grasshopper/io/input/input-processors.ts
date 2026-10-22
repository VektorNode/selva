import { ComputeError, ErrorCodes } from '@/core/errors';
import { getLogger } from '@/core/utils/logger';

import { normalizeDefault } from './normalize-default';
import { INPUT_TYPE_PARSERS, unknownTypeFallback } from './input-type-parsers';

import type { BaseInputType, InputParam, InputParamSchema, InputParseError } from '../../types';

const CANONICAL_PARAM_TYPES = new Map(
	[...INPUT_TYPE_PARSERS.keys()].map((key) => [key.toLowerCase(), key])
);

/** An unknown paramType comes back unchanged, so its unknown-type error still surfaces. */
function canonicalizeParamType(paramType: string): string {
	return CANONICAL_PARAM_TYPES.get(paramType?.toLowerCase()) ?? paramType;
}

/**
 * Parse one raw Grasshopper input schema into a typed {@link InputParam}.
 * A validation failure is swallowed and replaced with a safe default.
 */
export function processInput(rawInput: InputParamSchema): InputParam {
	return processInputWithError(rawInput).input;
}

/**
 * Like {@link processInput}, but also returns every problem found on the way, in
 * order: a dropped default, warnings the parser recovered from, and the parser
 * error that forced the safe default. Entries carry the RAW declared `paramType`
 * so clients match on the casing they sent.
 *
 * A non-`ComputeError` failure still throws: it is a bug, not bad input.
 */
export function processInputWithError(rawInput: InputParamSchema): {
	input: InputParam;
	errors: InputParseError[];
} {
	const label = rawInput.name || 'unknown';
	const errors: InputParseError[] = [];
	const report = ({ code, message }: { code: string; message: string }) => {
		errors.push({ inputName: label, paramType: rawInput.paramType, message, code });
	};

	const baseInput: BaseInputType = {
		description: rawInput.description,
		name: rawInput.name,
		nickname: rawInput.nickname,
		treeAccess: rawInput.treeAccess,
		// Absent, not '': "no group" must stay distinct from an empty group name.
		groupName: rawInput.groupName ?? undefined,
		id: rawInput.id
	};

	// Selva schemas send "valueList", the plugin "ValueList".
	const paramType = canonicalizeParamType(rawInput.paramType);

	let schema: InputParamSchema = { ...rawInput, paramType };
	try {
		const { schema: normalized, warning } = normalizeDefault(schema, label);
		schema = normalized;
		if (warning) report(warning);
	} catch (error) {
		// A default too malformed to walk is bad data, not a bug: drop it for this
		// input rather than failing the whole definition-IO fetch.
		schema = { ...schema, default: null };
		report({
			code: ErrorCodes.MALFORMED_DEFAULT,
			message: `Input "${label}" default could not be normalized and was dropped: ${
				error instanceof Error ? error.message : String(error)
			}`
		});
	}

	const parser = INPUT_TYPE_PARSERS.get(paramType);
	try {
		if (!parser) throw ComputeError.unknownParamType(paramType, rawInput.name);
		return { input: parser.parse(schema, baseInput, report), errors };
	} catch (error) {
		if (!(error instanceof ComputeError)) {
			throw new ComputeError(
				error instanceof Error ? error.message : String(error),
				ErrorCodes.VALIDATION_ERROR,
				{
					context: { paramName: rawInput.name, paramType },
					originalError: error instanceof Error ? error : new Error(String(error))
				}
			);
		}
		getLogger().error(`Validation error for input ${label}:`, error.message);
		report(error);
		const fallback = parser?.fallback ?? unknownTypeFallback;
		return { input: fallback(schema, baseInput), errors };
	}
}

/** {@link processInputWithError} over a list, with every input's errors collected. */
export function processInputsWithErrors(rawInputs: InputParamSchema[]): {
	inputs: InputParam[];
	parseErrors: InputParseError[];
} {
	const inputs: InputParam[] = [];
	const parseErrors: InputParseError[] = [];
	for (const raw of rawInputs) {
		const { input, errors } = processInputWithError(raw);
		inputs.push(input);
		parseErrors.push(...errors);
	}
	return { inputs, parseErrors };
}
