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
 * typing) — but NOT byte-for-byte wire data. The response IS normalized:
 * per-param field KEYS are canonicalized to camelCase across server branches
 * ({@link normalizeInputSchema} / {@link normalizeOutputSchema}, with honest
 * fallbacks for missing required fields), missing/non-array `inputs`/`outputs`
 * coerce to `[]`, and server load diagnostics surface as
 * `loadWarnings`/`loadErrors` (coerced to strings). Field VALUES — notably
 * `default` and the `values` dropdown-label map — pass through verbatim.
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

	// The `/io` response is only partially camelCased, and how much depends on the
	// server branch. Upstream-tracking branches (mcneel 8.x/9.x, `8.x.selva`) keep
	// the C# classes close to source — they carry few/no `[JsonProperty]`, so the
	// top-level wrapper is PascalCase `Inputs` / `Outputs` and per-param fields are
	// `ParamType` / `Minimum` / … The VektorNode Compute8 fork camelCases every
	// field. So we read every field we depend on case-insensitively via `readField`
	// rather than straight-through. A deep `camelcaseKeys` pass is NOT an option: it
	// mangled user-authored value-list label keys ("Option A" → "optionA") and item
	// `data` JSON — which is why per-field reads exist instead (per-input field
	// normalization lives in normalize-schema.ts; the nested `default` DataTree is
	// handled by normalize-default.ts).
	//
	// The server also reports definition-LOAD diagnostics on the IO response
	// (`errors`/`warnings` — e.g. a missing plugin that left inputs unresolved).
	// Surface them so a degraded input list comes with an explanation instead of
	// silently looking empty. Only attach when non-empty to keep the common
	// happy-path result clean.
	const loadWarnings = nonEmptyStrings(readField(response, 'warnings'));
	const loadErrors = nonEmptyStrings(readField(response, 'errors'));

	// Read the top-level Inputs/Outputs case-insensitively, then guard to arrays.
	// A server fault can also return a 200 whose body omits these (e.g. a load
	// failure surfacing as malformed-success), and the downstream `for...of` in
	// processInputsWithErrors throws "inputs is not iterable". Array.isArray (not
	// `?? []`) is deliberate: the symptom is non-iterability, so a non-array truthy
	// value (`{}`, a string) must coerce to `[]` too. The loadErrors/loadWarnings
	// surfaced above explain *why* a list came back empty.
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
 * Coerce a server `errors`/`warnings` array (typed `any[]`) into a clean
 * `string[]`, or `undefined` when there's nothing to report.
 *
 * Non-string diagnostics are KEPT, not dropped: a server fork reporting errors
 * as `{ message }` objects must not yield a mysteriously empty inputs list with
 * zero explanation (the exact failure this surfacing exists to prevent).
 * Objects coerce to their `message` field when it's a non-blank string, else
 * to JSON; other primitives via `String(...)`. Only `null`/`undefined` and
 * blank entries are discarded.
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
