import { ComputeConfig, ComputeError, ErrorCodes } from '@/core';
import { fetchCompute } from '@/core/compute-fetch/compute-fetch';
import { readField } from '@/core/utils/read-field';
import { warnIfClientSide } from '@/core/utils/warnings';
import { prepareGrasshopperArgs, withGrasshopperErrorCodes } from '../solve';

import { GrasshopperParsedIO, GrasshopperParsedIORaw } from '../types';

import { processInputsWithErrors } from './input/input-processors';
import { normalizeInputSchema, normalizeOutputSchema } from './normalize-schema';

/**
 * Fetches a definition's input/output schemas without per-type parsing.
 *
 * Field KEYS are canonicalized to camelCase and missing required fields get a
 * fallback ({@link normalizeInputSchema}); a missing or non-array `inputs` /
 * `outputs` becomes `[]`. Field VALUES, notably `default` and the `values`
 * label map, pass through verbatim.
 *
 * @throws {ComputeError} If fetch fails or response is invalid
 *
 * @public Use `fetchParsedDefinitionIO()` for processed, type-safe inputs
 */
export async function fetchDefinitionIO(
	definition: string | Uint8Array,
	config: ComputeConfig
): Promise<GrasshopperParsedIORaw> {
	warnIfClientSide('fetchDefinitionIO', config.suppressBrowserWarning);

	const { algo, pointer } = prepareGrasshopperArgs(definition, []);
	if (!algo && !pointer) {
		throw new ComputeError(
			'Definition must resolve to either a URL pointer or base64 algo',
			ErrorCodes.INVALID_INPUT
		);
	}

	const response = await fetchCompute<unknown>(
		'io',
		algo ? { algo } : { pointer },
		withGrasshopperErrorCodes(config)
	);

	if (!response || typeof response !== 'object') {
		throw new ComputeError('Invalid IO response structure', ErrorCodes.INVALID_INPUT, {
			context: { response }
		});
	}

	const loadWarnings = nonEmptyStrings(readField(response, 'warnings'));
	const loadErrors = nonEmptyStrings(readField(response, 'errors'));

	// Array.isArray, not `?? []`: a load failure can surface as a 200 whose
	// `inputs` is `{}` or a string, and that must become `[]` too.
	const rawInputs = readField(response, 'inputs');
	const rawOutputs = readField(response, 'outputs');
	return {
		inputs: Array.isArray(rawInputs) ? rawInputs.map(normalizeInputSchema) : [],
		outputs: Array.isArray(rawOutputs) ? rawOutputs.map(normalizeOutputSchema) : [],
		...(loadWarnings && { loadWarnings }),
		...(loadErrors && { loadErrors })
	};
}

/**
 * Server diagnostics as non-blank strings, or `undefined` when there are none.
 * Non-string entries are kept, not dropped: a fork reporting `{ message }`
 * objects must not yield an empty input list with no explanation.
 */
function nonEmptyStrings(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const cleaned = value.map(coerceDiagnostic).filter((v): v is string => v !== undefined);
	return cleaned.length > 0 ? cleaned : undefined;
}

function coerceDiagnostic(value: unknown): string | undefined {
	if (value === null || value === undefined) return undefined;
	let text: string;
	if (typeof value === 'string') {
		text = value;
	} else if (typeof value === 'object') {
		const message = readField<unknown>(value, 'message');
		if (typeof message === 'string' && message.trim().length > 0) {
			text = message;
		} else {
			try {
				text = JSON.stringify(value) ?? String(value);
			} catch {
				text = String(value);
			}
		}
	} else {
		text = String(value);
	}
	return text.trim().length > 0 ? text : undefined;
}

/**
 * Fetches a definition's input/output schemas and parses each input into its
 * typed `InputParam`. An input that fails to parse gets a safe default
 * and an entry in `parseErrors`.
 *
 * @throws {ComputeError} If fetch fails or response is invalid
 *
 * @example
 * ```typescript
 * const { inputs, outputs } = await fetchParsedDefinitionIO(
 *   'https://example.com/definition.gh',
 *   { serverUrl: 'http://localhost:6500', apiKey: 'YOUR_KEY' }
 * );
 *
 * // Inputs are now strongly typed
 * inputs.forEach(input => {
 *   if (input.paramType === 'Number') {
 *     console.log(input.minimum, input.maximum); // TypeScript knows these exist
 *   }
 * });
 * ```
 */
export async function fetchParsedDefinitionIO(
	definition: string | Uint8Array,
	config: ComputeConfig
): Promise<GrasshopperParsedIO> {
	const {
		inputs: rawInputs,
		outputs,
		loadWarnings,
		loadErrors
	} = await fetchDefinitionIO(definition, config);
	const { inputs, parseErrors } = processInputsWithErrors(rawInputs);

	return {
		inputs,
		outputs,
		...(parseErrors.length > 0 && { parseErrors }),
		...(loadWarnings && { loadWarnings }),
		...(loadErrors && { loadErrors })
	};
}
