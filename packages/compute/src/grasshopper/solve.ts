import { fetchRhinoCompute, RhinoComputeError, ErrorCodes } from '@/core';
import type { ComputeConfig, ServerErrorCodeMap } from '@/core/types';
import { getResponseWireSize, setResponseWireSize } from '@/core/compute-fetch/wire-size';
import { base64ByteArray, detectBase64Payload, encodeStringToBase64 } from '@/core/utils/encoding';
import { getLogger } from '@/core/utils/logger';
import { readField } from '@/core/utils/read-field';
import { warnIfClientSide } from '@/core/utils/warnings';

import {
	GrasshopperRequestSchema,
	GrasshopperComputeConfig,
	GrasshopperComputeResponse,
	DataTree
} from './types';
import { isDefinitionRef, type SolveDefinition } from '@/core/definition-ref';

/**
 * The exact message the server throws when it can neither resolve a `pointer`
 * nor a base64 `algo` to a definition (ResthopperEndpoints.cs). This is the
 * signal that a cache-key pointer missed the server's definition cache (GC'd, or
 * a different child in the pool), so the caller should retry with the full
 * definition. Matched as a substring because the server wraps it with a category
 * prefix in its exception handler.
 *
 * NOTE: the server only includes this message when running in debug mode; its
 * production exception handler scrubs the message to a generic string. The
 * reliable signal is therefore {@link ErrorCodes.DEFINITION_NOT_CACHED}, derived
 * from the server's machine `code` (which isn't scrubbed). The string match is
 * kept as a fallback for debug-mode servers and forks that don't yet emit a code.
 */
const DEFINITION_LOAD_FAILED = 'Unable to load grasshopper definition';

/**
 * Wire codes rhino.compute tags onto its error bodies. Passed to the transport
 * on every Grasshopper request — `core/` deliberately knows no backend's codes.
 */
export const GRASSHOPPER_SERVER_ERROR_CODES: ServerErrorCodeMap = {
	definition_not_cached: ErrorCodes.DEFINITION_NOT_CACHED
};

/** Attach the Grasshopper wire-code table without clobbering a caller's own entries. */
export function withGrasshopperErrorCodes<T extends ComputeConfig>(config: T): T {
	return {
		...config,
		serverErrorCodes: { ...GRASSHOPPER_SERVER_ERROR_CODES, ...config.serverErrorCodes }
	};
}

/** Does this error look like a server-side definition-load miss? */
function isDefinitionLoadMiss(error: unknown): boolean {
	if (!(error instanceof RhinoComputeError)) return false;
	return (
		error.code === ErrorCodes.DEFINITION_NOT_CACHED ||
		error.message.includes(DEFINITION_LOAD_FAILED)
	);
}

/**
 * Debug aid: a solve can return successfully yet hand back outputs whose
 * `InnerTree` is empty (`{}`), meaning that parameter produced nothing — often a
 * sign the definition didn't actually compute (wrong/missing inputs, a guarded
 * branch). The names tell you exactly which output was empty so you can trace it
 * back to the responsible branch.
 *
 * Only logs when `debug` is set: an empty output can be legitimate, so this is a
 * diagnostic, never a hard failure. Reads `ParamName` / `InnerTree`
 * case-insensitively to stay robust across server-branch casing.
 *
 * @internal Exported for testing.
 */
export function warnOnEmptyInnerTrees(response: GrasshopperComputeResponse, debug?: boolean): void {
	if (!debug) return;

	const values = readField<unknown[]>(response, 'values');
	if (!Array.isArray(values) || values.length === 0) return;

	const empty: string[] = [];
	for (const param of values) {
		const innerTree = readField<Record<string, unknown>>(param, 'innerTree');
		// Treat a missing or empty innerTree as "produced nothing".
		if (!innerTree || Object.keys(innerTree).length === 0) {
			empty.push(readField<string>(param, 'paramName') ?? '<unnamed>');
		}
	}

	if (empty.length === 0) return;

	const scope = empty.length === values.length ? 'all' : `${empty.length}/${values.length}`;
	getLogger().warn(
		`Solve returned empty output(s) (${scope}): ${empty.join(', ')}. ` +
			`These parameters produced no data — check the definition's inputs and the branch feeding each.`
	);
}

/**
 * Result of a solve that also reports the definition's server-side cache key.
 *
 * `cacheKey` is the `md5_…` identifier the server assigned to the (base64)
 * definition — stable for identical content. A caller that holds it can solve
 * the same definition again by reference (`pointer: cacheKey`) instead of
 * re-uploading the full base64, which matters a lot for large (multi-MB)
 * definitions on a live UI. For a URL-pointer solve the server echoes the
 * request schema back, so `cacheKey` is the definition URL itself (already a
 * reference — nothing gained by re-pointing at it). `null` only when the
 * server's response carried no `pointer` at all — do NOT use `null` to detect
 * URL-pointer solves.
 */
export interface SolveWithCacheKey {
	response: GrasshopperComputeResponse;
	cacheKey: string | null;
}

/**
 * Runs a Rhino Compute job using the provided tree prototypes and Grasshopper definition.
 *
 * @public Use this for direct compute control. For high-level API, use `GrasshopperClient.solve()`.
 *
 * @param dataTree - An array of `DataTree` objects representing the input data for the compute job.
 * @param definition - The Grasshopper definition, which can be:
 *   - A URL string (e.g., 'https://example.com/definition.gh')
 *   - A base64-encoded string of the .gh file
 *   - A plain string (will be base64-encoded)
 *   - A Uint8Array of the .gh file (will be base64-encoded)
 *   - A `DefinitionRef` (bytes are loaded via `ref.load()` for the upload)
 * @param config - Compute configuration (server URL, API key, etc. along with optional timeout, units, etc.)
 * @returns An object containing the compute result and extracted file data.
 *
 * @example
 * // Using a URL
 * await solveGrasshopperDefinition(trees, 'https://example.com/definition.gh', config);
 *
 * // Using a base64 string
 * await solveGrasshopperDefinition(trees, 'UEsDBBQAAAAIAL...', config);
 *
 * // Using binary data
 * const fileData = new Uint8Array([...]);
 * await solveGrasshopperDefinition(trees, fileData, config);
 */
export async function solveGrasshopperDefinition(
	dataTree: DataTree[],
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<GrasshopperComputeResponse> {
	// Not gated on `debug`: exposing an API key in the browser is a security
	// concern in every configuration. `suppressBrowserWarning` is the opt-out.
	warnIfClientSide('solveGrasshopperDefinition', config.suppressBrowserWarning);

	const bytes = await materializeDefinition(definition);
	const { response } = await runSolve(prepareGrasshopperArgs(bytes, dataTree), config);
	return response;
}

/**
 * Solve while reporting the server's definition cache key.
 *
 * Behaves like {@link solveGrasshopperDefinition} but returns the `cacheKey` the
 * server assigned, so a caller (e.g. the scheduler) can later solve the same
 * definition by reference instead of re-uploading it. The cache key is only
 * meaningful for base64/binary definitions; a URL-pointer solve returns the URL.
 *
 * @internal
 */
export async function solveGrasshopperDefinitionWithCacheKey(
	dataTree: DataTree[],
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey> {
	warnIfClientSide('solveGrasshopperDefinitionWithCacheKey', config.suppressBrowserWarning);

	const bytes = await materializeDefinition(definition);
	return runSolve(prepareGrasshopperArgs(bytes, dataTree), config);
}

/**
 * Solve a definition by its server-side cache key (`pointer: cacheKey`),
 * skipping the (potentially multi-MB) base64 upload. If the key has been evicted
 * from the server's definition cache — `DEFINITION_LOAD_FAILED` — transparently
 * retry once with the full `definition` and report the fresh cache key so the
 * caller can update its mapping. A `DefinitionRef` definition is only
 * materialized (`ref.load()`) inside that miss branch — a pointer hit never
 * touches the bytes.
 *
 * @returns The solve result plus the (possibly refreshed) cache key, and whether
 *   the fast path missed (so callers can record the new key / track hit rate).
 * @internal
 */
export async function solveByCacheKey(
	dataTree: DataTree[],
	cacheKey: string,
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey & { missed: boolean }> {
	warnIfClientSide('solveByCacheKey', config.suppressBrowserWarning);

	const pointerArgs: GrasshopperRequestSchema = { algo: null, pointer: cacheKey, values: dataTree };

	try {
		const fast = await runSolve(pointerArgs, config);
		return { ...fast, missed: false };
	} catch (error) {
		if (!isDefinitionLoadMiss(error)) throw error;
		// Cache miss — fall back to the full upload and capture the fresh key.
		const bytes = await materializeDefinition(definition);
		const full = await runSolve(prepareGrasshopperArgs(bytes, dataTree), config);
		return { ...full, missed: true };
	}
}

/**
 * Resolve a definition to uploadable form: a `DefinitionRef` is materialized
 * via `load()` (failures are wrapped so callers get a `RhinoComputeError`
 * naming the ref, not an opaque loader exception); other forms pass through.
 */
async function materializeDefinition(definition: SolveDefinition): Promise<string | Uint8Array> {
	if (!isDefinitionRef(definition)) return definition;
	try {
		return await definition.load();
	} catch (error) {
		throw new RhinoComputeError(
			`Failed to load definition bytes for ref '${definition.key}'`,
			ErrorCodes.INVALID_INPUT,
			{
				context: { definitionKey: definition.key },
				originalError: error instanceof Error ? error : new Error(String(error))
			}
		);
	}
}

/**
 * Shared solve body: apply optional settings, POST, and split the server's
 * `pointer` (its cache key) off the response. `algo` — the request's full
 * base64 definition echoed back on every solve — is stripped too: keeping it
 * pins a multi-MB copy per response, which would consume the scheduler cache's
 * byte budget many times over. Stripping via shallow copy rather than `delete`
 * keeps any already-observed response object unmutated.
 */
async function runSolve(
	args: GrasshopperRequestSchema,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey> {
	applyOptionalComputeSettings(args, config);

	const result = await fetchRhinoCompute<GrasshopperComputeResponse>(
		'grasshopper',
		args,
		withGrasshopperErrorCodes(config)
	);

	const {
		pointer,
		algo: _algo,
		...rest
	} = result as GrasshopperComputeResponse & { pointer?: unknown; algo?: unknown };
	const response = rest as GrasshopperComputeResponse;
	// The wire-size hint follows object identity, so the stripped copy must
	// re-register it — minus the echoed `algo`, which is no longer retained (it
	// can dwarf the actual outputs for a large definition).
	const wireSize = getResponseWireSize(result);
	if (wireSize !== undefined) {
		const algoLength = typeof _algo === 'string' ? _algo.length : 0;
		setResponseWireSize(response, Math.max(0, wireSize - algoLength));
	}
	warnOnEmptyInnerTrees(response, config.debug);
	return {
		response,
		cacheKey: typeof pointer === 'string' ? pointer : null
	};
}

// ============================================================================
// Grasshopper Arguments
// ============================================================================

/**
 * Prepares Grasshopper arguments from a definition and data tree.
 * Automatically detects the definition format and converts it appropriately.
 *
 * @param definition - Can be a URL, base64 string, plain string, or Uint8Array
 * @param dataTree - Array of DataTree objects for compute inputs
 * @internal
 */
export function prepareGrasshopperArgs(
	definition: string | Uint8Array,
	dataTree: DataTree[]
): GrasshopperRequestSchema {
	const args: GrasshopperRequestSchema = {
		algo: null,
		pointer: null,
		values: dataTree
	};

	if (definition instanceof Uint8Array) {
		// Binary data → convert to base64
		args.algo = base64ByteArray(definition);
	} else if (/^https?:\/\//i.test(definition)) {
		// URL → use as pointer reference
		args.pointer = definition;
	} else {
		// Base64 detection is a heuristic (see detectBase64Payload): only long
		// (≥64 data chars), canonical base64 is passed through — normalized, so
		// newline-wrapped/unpadded definitions reach the server decodable instead
		// of double-encoded. Everything else (incl. short base64-shaped strings
		// like "test") is treated as a plain string and encoded. Pass a
		// Uint8Array to bypass sniffing entirely.
		args.algo = detectBase64Payload(definition) ?? encodeStringToBase64(definition);
	}

	return args;
}

/**
 * @internal
 */
export function applyOptionalComputeSettings(
	arglist: GrasshopperRequestSchema,
	options: GrasshopperComputeConfig
): void {
	if (options.cachesolve != null) arglist.cachesolve = options.cachesolve;
	if (options.cacheerroredsolves != null) arglist.cacheerroredsolves = options.cacheerroredsolves;
	if (options.modelunits != null) arglist.modelunits = options.modelunits;
	if (options.angletolerance != null) arglist.angletolerance = options.angletolerance;
	if (options.absolutetolerance != null) arglist.absolutetolerance = options.absolutetolerance;
	if (options.dataversion != null) arglist.dataversion = options.dataversion;
}
