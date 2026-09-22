import { ComputeConfig, ComputeError, ErrorCodes } from '@/core';
import { fetchCompute } from '@/core/compute-fetch/compute-fetch';
import { readField } from '@/core/utils/read-field';
import { warnIfClientSide } from '@/core/utils/warnings';
import { prepareGrasshopperArgs, withGrasshopperErrorCodes } from '../solve';

import { GrasshopperParsedIO, GrasshopperParsedIORaw, IoResponseSchema } from '../types';

import { processInputsWithErrors } from './input/input-processors';
import { normalizeInputSchema, normalizeOutputSchema } from './normalize-schema';

/**
 * Fetches raw input/output schemas from a Grasshopper definition.
 *
 * "Raw" means no per-type parsing (no default coercion, no discriminated-union
 * typing): but NOT byte-for-byte wire data. Per-param field KEYS are
 * canonicalized to camelCase across server branches ({@link normalizeInputSchema} /
 * {@link normalizeOutputSchema}), missing/non-array `inputs`/`outputs` coerce to
 * `[]`, and server load diagnostics surface as `loadWarnings`/`loadErrors`. Field
 * VALUES: notably `default` and the `values` dropdown-label map: pass through
 * verbatim.
 *
 * @param definition - The Grasshopper definition (URL, base64 string, or Uint8Array)
 * @param config - Compute configuration (server URL, API key, etc.)
 * @returns Key-normalized inputs and outputs with no per-type processing
 * @throws {ComputeError} If fetch fails or response is invalid
 *
 * @public Use `fetchParsedDefinitionIO()` for processed, type-safe inputs
 */
export async function fetchDefinitionIO(
	definition: string | Uint8Array,
	config: ComputeConfig
): Promise<GrasshopperParsedIORaw> {
	const args = prepareGrasshopperArgs(definition, []);
	const payload: { algo?: string | null; pointer?: string | null } = {};
	if (args.algo) payload.algo = args.algo;
	if (args.pointer) payload.pointer = args.pointer;

	if (!payload.algo && !payload.pointer) {
		throw new ComputeError(
			'Definition must resolve to either a URL pointer or base64 algo',
			ErrorCodes.INVALID_INPUT,
			{ context: { definition } }
		);
	}

	const response = await fetchCompute<IoResponseSchema>(
		'io',
		payload,
		withGrasshopperErrorCodes(config)
	);

	if (!response || typeof response !== 'object') {
		throw new ComputeError('Invalid IO response structure', ErrorCodes.INVALID_INPUT, {
			context: { response, definition }
		});
	}

	// The `/io` response casing varies by server branch (see readField's doc), so every
	// field we depend on goes through `readField` rather than straight property access.
	// Per-input field normalization lives in normalize-schema.ts; the nested `default`
	// DataTree in normalize-default.ts.
	//
	// The server also reports definition-LOAD diagnostics here (`errors`/`warnings`, e.g.
	// a missing plugin that left inputs unresolved). Surface them so a degraded input list
	// comes with an explanation instead of silently looking empty.
	const loadWarnings = nonEmptyStrings(readField(response, 'warnings'));
	const loadErrors = nonEmptyStrings(readField(response, 'errors'));

	// A server fault can return a 200 whose body omits inputs/outputs (a load failure
	// surfacing as malformed-success); the downstream `for...of` in
	// processInputsWithErrors would throw "inputs is not iterable". Array.isArray (not
	// `?? []`) coerces any non-array truthy value (`{}`, a string) to `[]` too, since the
	// symptom is non-iterability, not just nullishness.
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
 * Coerce a server `errors`/`warnings` array into a clean `string[]`, or
 * `undefined` when there's nothing to report.
 *
 * Non-string diagnostics are KEPT, not dropped: a server reporting errors as
 * `{ message }` objects must not yield a mysteriously empty inputs list with no
 * explanation. Objects coerce to their `message` field when non-blank, else to
 * JSON; other primitives via `String(...)`. Only `null`/`undefined` and blank
 * entries are discarded.
 */
function nonEmptyStrings(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const cleaned = value.map(coerceDiagnostic).filter((v): v is string => v !== undefined);
	return cleaned.length > 0 ? cleaned : undefined;
}

/** One diagnostic entry → non-blank string, or `undefined` when there's nothing to say. */
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
 * Fetches and processes input/output schemas from a Grasshopper definition.
 * Returns strongly-typed, validated input parameters ready for use.
 *
 * @public This is the recommended way to fetch definition I/O schemas.
 *
 * @param definition - The Grasshopper definition (URL, base64 string, or Uint8Array)
 * @param config - Compute configuration (server URL, API key, etc.)
 * @returns Processed inputs with discriminated union types and outputs
 * @throws {ComputeError} If fetch fails or response is invalid
 *
 * @example
 * ```typescript
 * const { inputs, outputs } = await fetchParsedDefinitionIO(
 *   'https://example.com/definition.gh',
 *   { serverUrl: 'https://compute.rhino3d.com', apiKey: 'YOUR_KEY' }
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
	warnIfClientSide('fetchParsedDefinitionIO', config.suppressBrowserWarning);

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
