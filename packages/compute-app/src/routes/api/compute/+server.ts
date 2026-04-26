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
import type { ComputeServerConfig, RequestContext } from '@selva/platform';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { isSafeRemoteDefinitionUrl } from '$lib/server/compute/safe-url';
import { getStorageProvider, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';

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

/** Hard cap on remote definition fetches. Tracks `MAX_GH_FILE_SIZE` for uploads. */
const REMOTE_DEFINITION_MAX_BYTES = 50 * 1024 * 1024;
/** Per-request fetch deadline. */
const REMOTE_DEFINITION_FETCH_TIMEOUT_MS = 30_000;

/** Singleton GrasshopperClient instance */
let cachedClient: GrasshopperClient | null = null;
let cachedClientConfig: { serverUrl: string; apiKey?: string } | null = null;

/**
 * Get or create a GrasshopperClient for the resolved server. The cache is
 * keyed by serverUrl + apiKey identity so distinct orgs sharing a server
 * reuse one warm client; switching servers invalidates and rebuilds.
 */
async function getClient(serverConfig: ComputeServerConfig): Promise<GrasshopperClient> {
	const currentConfig = {
		serverUrl: serverConfig.serverUrl,
		apiKey: serverConfig.apiKey
	};

	if (
		cachedClient &&
		cachedClientConfig &&
		cachedClientConfig.serverUrl === currentConfig.serverUrl &&
		cachedClientConfig.apiKey === currentConfig.apiKey
	) {
		return cachedClient;
	}

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
 *
 * SSRF protection:
 *   - private/loopback/link-local hosts rejected up-front
 *   - `redirect: 'error'` so a public host can't bounce us to a private IP
 *   - response size capped via Content-Length AND streamed-byte budget
 *   - hard timeout via AbortController
 */
async function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	if (!isSafeRemoteDefinitionUrl(url)) {
		throw new Error('Remote definition URL is not allowed');
	}

	const now = Date.now();
	const cached = definitionCache.get(url);

	// Return cached if still fresh
	if (cached && now - cached.fetchedAt < DEFINITION_CACHE_TTL) {
		return cached.data;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), REMOTE_DEFINITION_FETCH_TIMEOUT_MS);
	let data: Uint8Array;
	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: 'error'
		});
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		const declared = Number(response.headers.get('content-length'));
		if (Number.isFinite(declared) && declared > REMOTE_DEFINITION_MAX_BYTES) {
			throw new Error('Remote definition exceeds size limit');
		}
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > REMOTE_DEFINITION_MAX_BYTES) {
			throw new Error('Remote definition exceeds size limit');
		}
		data = new Uint8Array(buffer);
	} finally {
		clearTimeout(timeout);
	}

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

export const POST: RequestHandler = async ({ request, locals, url }) => {
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
		// Track which org owns the definition so BYO compute can route the solve
		// to that org's override server (spec §3). Null when the definition is
		// externally hosted — no tenant context, fall through to instance pool.
		let solveOrgId: string | null = null;

		// Spec §7 — share-link tokens authenticate anonymous solves to one
		// (definitionId, channel). Only meaningful for `local:` URLs; remote
		// definitions stay user-auth-only.
		const isLocal = definitionUrl.startsWith('local:');
		const guid = isLocal ? definitionUrl.substring(6) : null;
		const sharedAccess =
			isLocal && guid
				? await tryResolveShareToken(request, url, guid, channel, { requireSolve: true })
				: null;

		// User-auth fallback: every non-token request still needs a session.
		if (!sharedAccess && (!locals.ctx || !locals.user)) {
			throw error(401, 'Unauthorized');
		}

		// `solveCtx` is the data-layer context — synthetic when token-resolved,
		// the user's ctx otherwise. Used for definition + version + project reads.
		const solveCtx: RequestContext = sharedAccess?.ctx ?? locals.ctx!;

		if (isLocal && guid) {
			let record;
			try {
				record = await providers.data.definitions.get(solveCtx, guid);
			} catch (err) {
				console.error(`Failed to load local definition: ${guid}`, err);
				throw error(404, `Definition '${guid}' not found`);
			}
			if (!record) throw error(404, `Definition '${guid}' not found`);

			const project = await providers.data.projects.getProject(solveCtx, record.projectId);
			solveOrgId = project?.orgId ?? null;

			// Token-resolved requests skip the user-auth gate (the token IS the
			// authorization). Otherwise enforce the channel-appropriate user rule.
			if (!sharedAccess) {
				if (channel === 'draft') {
					await requireCanEditDefinition(locals, record.projectId, guid);
				} else {
					await requireCanSolve(locals, record.projectId);
				}
			}

			const versionId = channel === 'live' ? record.liveVersionId : record.draftVersionId;
			if (!versionId) {
				throw error(404, `Definition '${guid}' has no ${channel} version yet`);
			}
			const version = await providers.data.definitions.getVersion(solveCtx, versionId);
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

		// Spec §7 — atomic check-and-increment BEFORE the solve, so a request
		// past the cap doesn't burn compute. Returns null when the cap is hit.
		if (sharedAccess) {
			const next = await providers.data.shareLinks.tryIncrementSolveCount(
				solveCtx,
				sharedAccess.link.id
			);
			if (next === null) {
				throw error(429, 'Share link solve cap reached.');
			}
		}

		const serverConfig = await resolveServerForOrg(solveCtx, solveOrgId);
		const client = await getClient(serverConfig);
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
