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
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { resolveComputeServer, SYSTEM_CONTEXT } from '@selva/platform';
import { getStorageProvider, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';

interface ComputeRequest {
	inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
	values: Record<string, unknown>;
	definitionUrl: string;
	/** Spec §6 channel selector. Defaults to 'live'. 'draft' requires editor. */
	channel?: 'live' | 'draft';
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
async function getClient(_definitionGuid?: string): Promise<GrasshopperClient> {
	const config = await getComputeServerConfigStore().getConfig(SYSTEM_CONTEXT);
	const serverConfig = resolveComputeServer(config);
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

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.ctx || !locals.user) {
		throw error(401, 'Unauthorized');
	}
	const storage = getStorageProvider();

	try {
		const body: ComputeRequest = await request.json();

		const { inputs, values } = body;
		const definitionUrl = body.definitionUrl;
		const channel: 'live' | 'draft' = body.channel ?? 'live';

		if (!inputs || !values || !definitionUrl) {
			throw error(400, 'Missing required fields: inputs, values, or definitionUrl');
		}
		if (channel !== 'live' && channel !== 'draft') {
			throw error(400, `Invalid channel: ${channel}. Must be 'live' or 'draft'.`);
		}

		let definitionSource: Uint8Array;

		const definitionGuid = definitionUrl.startsWith('local:')
			? definitionUrl.substring(6)
			: undefined;

		if (definitionUrl.startsWith('local:')) {
			const guid = definitionUrl.substring(6);
			let record;
			try {
				record = await providers.data.definitions.get(locals.ctx, guid);
			} catch (err) {
				console.error(`Failed to load local definition: ${guid}`, err);
				throw error(404, `Definition '${guid}' not found`);
			}
			if (!record) throw error(404, `Definition '${guid}' not found`);

			// 'live' is the public channel; 'draft' is for editors only (spec §6).
			if (channel === 'draft') {
				await requireCanEditDefinition(locals, record.projectId, guid);
			} else {
				await requireCanSolve(locals, record.projectId);
			}

			const versionId =
				channel === 'live' ? record.liveVersionId : record.draftVersionId;
			if (!versionId) {
				throw error(404, `Definition '${guid}' has no ${channel} version yet`);
			}
			const version = await providers.data.definitions.getVersion(locals.ctx, versionId);
			if (!version || version.definitionId !== guid) {
				throw error(404, `Definition '${guid}' ${channel} version is missing`);
			}

			try {
				const bytes = await storage.get(version.fileKey);
				if (!bytes) throw new Error(`Version blob missing: ${version.fileKey}`);
				definitionSource = bytes;
			} catch (err) {
				console.error(`Failed to load local definition blob: ${guid}`, err);
				throw error(404, `Definition '${guid}' not found`);
			}
		} else {
			// Externally-hosted definition; no tenant-scoped gate applies.
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
