import { fetchCompute, ComputeError, ErrorCodes } from '@/core';
import type { ComputeConfig, ServerErrorCodeMap } from '@/core/types';
import { getResponseWireSize, setResponseWireSize } from '@/core/compute-fetch/wire-size';
import { base64ByteArray, detectBase64Payload, encodeStringToBase64 } from '@/core/utils/encoding';
import { getLogger } from '@/core/utils/logger';
import { readField } from '@/core/utils/read-field';
import { warnIfClientSide } from '@/core/utils/warnings';
import { validateServerUrl } from '@/core/server/validate-server-url';

import {
	GrasshopperRequestSchema,
	GrasshopperComputeConfig,
	GrasshopperComputeResponse,
	DataTree
} from './types';
import { isDefinitionRef, isDefinitionUrl, type SolveDefinition } from '@/core/definition-ref';

/**
 * Server message for a `pointer` it can't resolve (evicted, or a different child in the pool).
 * Production servers scrub it, so the `definition_not_cached` code is the reliable signal; this
 * substring covers debug-mode servers and forks that emit no code.
 */
const DEFINITION_LOAD_FAILED = 'Unable to load grasshopper definition';

/** `core/` knows no backend's wire codes, so every Grasshopper request passes these in. */
const GRASSHOPPER_SERVER_ERROR_CODES: ServerErrorCodeMap = {
	definition_not_cached: ErrorCodes.DEFINITION_NOT_CACHED
};

/** Attach the Grasshopper wire-code table without clobbering a caller's own entries. */
export function withGrasshopperErrorCodes<T extends ComputeConfig>(config: T): T {
	return {
		...config,
		serverErrorCodes: { ...GRASSHOPPER_SERVER_ERROR_CODES, ...config.serverErrorCodes }
	};
}

function isDefinitionLoadMiss(error: unknown): boolean {
	if (!(error instanceof ComputeError)) return false;
	return (
		error.code === ErrorCodes.DEFINITION_NOT_CACHED ||
		error.message.includes(DEFINITION_LOAD_FAILED)
	);
}

/**
 * Debug-only: names the outputs that produced nothing, usually a definition that didn't compute
 * (missing inputs, a guarded branch). An empty output can be legitimate, so this only warns.
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
 * `cacheKey` is the server's `pointer`: its `md5_…` key for an uploaded definition, or the URL
 * echoed back for a URL definition. `null` means only that the response carried no pointer.
 */
export interface SolveWithCacheKey {
	response: GrasshopperComputeResponse;
	cacheKey: string | null;
}

/**
 * Run one solve. `GrasshopperClient.solve()` adds input validation and throws on solver errors.
 *
 * @param definition - A URL (sent as a pointer), base64 `.gh` content, raw `.gh` bytes, or a
 *   `DefinitionRef` (loaded for the upload). Any other string is encoded as the definition text.
 * @returns The compute response, without the server's `pointer` and echoed `algo`.
 *
 * @example
 * await solveGrasshopperDefinition(trees, 'https://example.com/definition.gh', config);
 * await solveGrasshopperDefinition(trees, new Uint8Array(await readFile('model.gh')), config);
 */
export async function solveGrasshopperDefinition(
	dataTree: DataTree[],
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<GrasshopperComputeResponse> {
	warnIfClientSide('solveGrasshopperDefinition', config.suppressBrowserWarning);
	return (await uploadAndSolve(dataTree, definition, config)).response;
}

/**
 * Solve by `pointer: cacheKey` when a key is known, skipping the upload. With no key, or when the
 * server has evicted it, upload the full definition and report `missed: true`. A `DefinitionRef`
 * is loaded only on that upload path.
 */
export async function solveWithServerCacheKey(
	dataTree: DataTree[],
	cacheKey: string | null,
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey & { missed: boolean }> {
	warnIfClientSide('solveWithServerCacheKey', config.suppressBrowserWarning);

	if (cacheKey !== null) {
		try {
			const hit = await runSolve({ algo: null, pointer: cacheKey, values: dataTree }, config);
			return { ...hit, missed: false };
		} catch (error) {
			if (!isDefinitionLoadMiss(error)) throw error;
		}
	}
	return { ...(await uploadAndSolve(dataTree, definition, config)), missed: true };
}

async function uploadAndSolve(
	dataTree: DataTree[],
	definition: SolveDefinition,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey> {
	const bytes = await materializeDefinition(definition);
	return runSolve(prepareGrasshopperArgs(bytes, dataTree), config);
}

async function materializeDefinition(definition: SolveDefinition): Promise<string | Uint8Array> {
	if (!isDefinitionRef(definition)) return definition;
	try {
		return await definition.load();
	} catch (error) {
		throw new ComputeError(
			`Failed to load definition bytes for ref '${definition.key}'`,
			ErrorCodes.INVALID_INPUT,
			{
				context: { definitionKey: definition.key },
				originalError: error
			}
		);
	}
}

/**
 * POST a solve and split the server's `pointer` off the response. The server echoes the request's
 * base64 definition back as `algo`; it is dropped so a cached response doesn't pin a multi-MB copy
 * of the definition against the scheduler's byte budget.
 */
async function runSolve(
	args: GrasshopperRequestSchema,
	config: GrasshopperComputeConfig
): Promise<SolveWithCacheKey> {
	validateServerUrl(config.serverUrl);
	applyOptionalComputeSettings(args, config);

	// The server echoes an uploaded definition back as `algo`: the limit is for the rest.
	const { maxResponseBytes } = config;
	const result = await fetchCompute<GrasshopperComputeResponse>(
		'grasshopper',
		args,
		withGrasshopperErrorCodes({
			...config,
			maxResponseBytes:
				maxResponseBytes !== undefined && args.algo
					? maxResponseBytes + args.algo.length
					: maxResponseBytes
		})
	);

	const {
		pointer,
		algo: _algo,
		...rest
	} = result as GrasshopperComputeResponse & { pointer?: unknown; algo?: unknown };
	const response = rest as GrasshopperComputeResponse;
	// The wire-size hint is keyed by object identity, so the copy re-registers it, minus `algo`.
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

/** @internal */
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
		args.algo = base64ByteArray(definition);
	} else if (isDefinitionUrl(definition)) {
		args.pointer = definition;
	} else {
		// Only long base64 passes through (see detectBase64Payload); a short base64-shaped string
		// like "test" is encoded as text. A Uint8Array skips the sniffing.
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
	if (options.selvaevents != null) arglist.selvaevents = options.selvaevents;
}
