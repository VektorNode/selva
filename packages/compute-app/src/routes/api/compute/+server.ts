import type { RequestHandler } from './$types';
import {
	type NumericInputType,
	type TextInputType,
	type BooleanInputType,
	type InputParam,
	TreeBuilder,
	GrasshopperClient
} from 'selva-compute';
import type { SchemaInput } from 'selva-shared';
import { error, json, isHttpError } from '@sveltejs/kit';
import { getComputeServerProvider } from '$lib/server/compute/config.server';
import { getDefinitionFiles } from '$lib/server/definitions.server';

interface ComputeRequest {
	inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
	values: Record<string, unknown>;
	definitionUrl: string;
}

// -----------------------------
// Caching infrastructure
// -----------------------------

/** Cache for remote definitions (URL -> bytes) */
const definitionCache = new Map<string, { data: Uint8Array; fetchedAt: number }>();

/** Cache TTL: 5 minutes */
const DEFINITION_CACHE_TTL = 5 * 60 * 1000;

/** Singleton GrasshopperClient instance */
let cachedClient: GrasshopperClient | null = null;
let cachedClientConfig: { serverUrl: string; apiKey?: string } | null = null;

/**
 * Get or create a GrasshopperClient instance.
 * Reuses existing client if config hasn't changed.
 */
async function getClient(definitionGuid?: string): Promise<GrasshopperClient> {
	const serverConfig = await getComputeServerProvider().getServer({ definitionGuid });
	const currentConfig = {
		serverUrl: serverConfig.serverUrl,
		apiKey: serverConfig.apiKey
	};

	// Check if we can reuse cached client
	if (
		cachedClient &&
		cachedClientConfig &&
		cachedClientConfig.serverUrl === currentConfig.serverUrl &&
		cachedClientConfig.apiKey === currentConfig.apiKey
	) {
		return cachedClient;
	}

	// Create new client
	cachedClient = await GrasshopperClient.create({
		serverUrl: currentConfig.serverUrl,
		apiKey: currentConfig.apiKey
	});
	cachedClientConfig = currentConfig;

	return cachedClient;
}

/**
 * Load definition from cache or fetch from remote URL.
 * Local definitions bypass cache (handled by container).
 */
async function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	const now = Date.now();
	const cached = definitionCache.get(url);

	// Return cached if still fresh
	if (cached && now - cached.fetchedAt < DEFINITION_CACHE_TTL) {
		return cached.data;
	}

	// Fetch fresh copy
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const data = new Uint8Array(await response.arrayBuffer());

	// Cache the result
	definitionCache.set(url, { data, fetchedAt: now });

	// Clean up old entries (simple LRU-ish cleanup)
	if (definitionCache.size > 50) {
		const entries = Array.from(definitionCache.entries());
		entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
		// Remove oldest 10 entries
		for (let i = 0; i < 10; i++) {
			definitionCache.delete(entries[i][0]);
		}
	}

	return data;
}

/**
 * Transform input parameter to Rhino Compute format
 */
function transformInputParameter(
	input: SchemaInput & { minimum?: number; maximum?: number; stepSize?: number },
	value: unknown
): InputParam {
	const base = {
		description: input.description || '',
		name: input.nickname,
		nickname: input.nickname || null,
		id: input.id
	};

	if (input.paramType === 'number' || input.paramType === 'integer') {
		return {
			...base,
			paramType: input.paramType === 'integer' ? 'Integer' : 'Number',
			minimum: input.minimum,
			maximum: input.maximum,
			stepSize: input.paramType === 'integer' ? 1 : input.stepSize,
			default: value ?? input.default
		} as NumericInputType;
	} else if (input.paramType === 'text') {
		return {
			...base,
			paramType: 'Text',
			default: (value as string) ?? input.default ?? ''
		} as TextInputType;
	} else if (input.paramType === 'boolean') {
		return {
			...base,
			paramType: 'Boolean',
			default: (value as boolean) ?? input.default ?? false
		} as BooleanInputType;
	}

	return {
		...base,
		paramType: 'Text',
		default: (value as string) ?? ''
	} as TextInputType;
}

export const POST: RequestHandler = async ({ request }) => {
	const files = getDefinitionFiles();

	try {
		const body: ComputeRequest = await request.json();

		const { inputs, values } = body;
		const definitionUrl = body.definitionUrl;

		if (!inputs || !values || !definitionUrl) {
			throw error(400, 'Missing required fields: inputs, values, or definitionUrl');
		}

		// Determine definition source
		let definitionSource: Uint8Array;

		// Extract GUID for per-definition compute routing
		const definitionGuid = definitionUrl.startsWith('local:')
			? definitionUrl.substring(6)
			: undefined;

		if (definitionUrl.startsWith('local:')) {
			// Extract GUID from local URL (format: "local:{guid}")
			const guid = definitionUrl.substring(6);
			try {
				const bytes = await files.getFile(guid);
				if (!bytes) throw new Error(`Definition '${guid}' not found on disk`);
				definitionSource = bytes;
			} catch (err) {
				console.error(`Failed to load local definition: ${guid}`, err);
				throw error(404, `Definition '${guid}' not found`);
			}
		} else {
			// Fetch from remote URL (with caching)
			try {
				definitionSource = await loadRemoteDefinition(definitionUrl);
			} catch (err) {
				console.error(`Failed to fetch definition from ${definitionUrl}:`, err);
				throw error(
					400,
					`Failed to load definition: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		const inputTree = TreeBuilder.fromInputParams(
			inputs
				.filter((input) => input.paramType)
				.map((input) => transformInputParameter(input, values[input.id]))
		);

		// Use cached client (passes definitionGuid for potential per-definition routing)
		const client = await getClient(definitionGuid);
		const solvedDefinition = await client.solve(definitionSource, inputTree);

		return json(solvedDefinition);
	} catch (err) {
		// Re-throw SvelteKit errors (400, 404, etc.) as-is
		if (isHttpError(err)) throw err;

		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[API/Compute] Error:', message);

		// Distinguish connectivity errors from other failures
		if (err instanceof TypeError && message === 'fetch failed') {
			throw error(503, 'Compute server is unreachable');
		}

		throw error(500, message);
	}
};
