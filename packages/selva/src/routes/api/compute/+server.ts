import type { RequestHandler } from './$types';
import {
	type NumericInputType,
	type TextInputType,
	type BooleanInputType,
	type InputParam,
	TreeBuilder,
	GrasshopperClient,
	enableDebugLogging,
	type SolveScheduler
} from '@selvajs/compute';
import { env } from '$env/dynamic/private';
import type { SchemaInput } from '@selvajs/schemas';
import { error, isHttpError } from '@sveltejs/kit';
import type { ComputeServerConfig, RequestContext } from '@selvajs/platform';
import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { isSafeRemoteDefinitionUrl } from '$lib/server/compute/safe-url';
import { checkComputeRateLimit } from '$lib/server/computeRateLimit.server';
import {
	COMPUTE_REQUEST_MAX_BYTES,
	COMPUTE_RESPONSE_MAX_BYTES,
	DEFINITION_CACHE_TTL_MS,
	MAX_SOLVE_DURATION_MS,
	REMOTE_DEFINITION_FETCH_TIMEOUT_MS,
	REMOTE_DEFINITION_MAX_BYTES
} from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { getStorageProvider, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';

interface ComputeRequest {
	inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
	values: Record<string, unknown>;
	definitionUrl: string;
	/** Spec §6 channel selector. Defaults to 'live'. 'draft' requires editor. */
	channel?: 'live' | 'draft';
}

// Logs upstream Rhino.Compute response body on failures (off by default).
const COMPUTE_DEBUG = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
);
if (COMPUTE_DEBUG) enableDebugLogging();

// -----------------------------
// Caching infrastructure
// -----------------------------

/** Cache for remote definitions (URL -> bytes). TTL/caps come from computeLimits. */
const definitionCache = new Map<string, { data: Uint8Array; fetchedAt: number }>();

// Singleton with dedup cache; AbortSignal kills orphan solves on client disconnect.
let cachedClient: GrasshopperClient | null = null;
let cachedScheduler: SolveScheduler | null = null;
let cachedClientConfig: { serverUrl: string; apiKey?: string } | null = null;

async function getClient(
	serverConfig: ComputeServerConfig
): Promise<{ client: GrasshopperClient; scheduler: SolveScheduler }> {
	const currentConfig = {
		serverUrl: serverConfig.serverUrl,
		apiKey: serverConfig.apiKey
	};

	if (
		cachedClient &&
		cachedScheduler &&
		cachedClientConfig &&
		cachedClientConfig.serverUrl === currentConfig.serverUrl &&
		cachedClientConfig.apiKey === currentConfig.apiKey
	) {
		return { client: cachedClient, scheduler: cachedScheduler };
	}

	// Drop scheduler on server change to prevent state leakage.
	cachedScheduler?.dispose();

	cachedClient = await GrasshopperClient.create({
		serverUrl: currentConfig.serverUrl,
		apiKey: currentConfig.apiKey,
		debug: COMPUTE_DEBUG
	});
	cachedScheduler = cachedClient.createScheduler({
		mode: 'queue',
		timeoutMs: MAX_SOLVE_DURATION_MS,
		cache: { maxEntries: 20, ttlMs: 5 * 60_000 },
		// VektorNode fork returns empty 200 on stale pointer; disable until it errors.
		reuseServerDefinitionCache: false
	});
	cachedClientConfig = currentConfig;
	return { client: cachedClient, scheduler: cachedScheduler };
}

// SSRF checks: up-front host validation, redirect:'error', size caps, timeout.
async function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	if (!isSafeRemoteDefinitionUrl(url)) {
		throw new Error('Remote definition URL is not allowed');
	}

	const now = Date.now();
	const cached = definitionCache.get(url);

	if (cached && now - cached.fetchedAt < DEFINITION_CACHE_TTL_MS) {
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

	definitionCache.set(url, { data, fetchedAt: now });

	if (definitionCache.size > 50) {
		const entries = Array.from(definitionCache.entries());
		entries.sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
		for (let i = 0; i < 10; i++) {
			definitionCache.delete(entries[i][0]);
		}
	}

	return data;
}

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

	// Reject oversized payloads before buffering.
	requireMaxBodySize(request, COMPUTE_REQUEST_MAX_BYTES);

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
		// BRIDGE: remove ~2026-09 — lazy schema backfill for pre-cached versions.
		let localVersionForBackfill: { id: string; hasSchema: boolean } | null = null;
		// BYO compute routing per org (spec §3); null for remote definitions.
		let solveOrgId: string | null = null;
		// Per-definition compute pin (spec §3 step 1).
		let definitionPin: string | null = null;

		// Share-link tokens (spec §7); null for remote definitions or no token.
		const isLocal = definitionUrl.startsWith('local:');
		const guid = isLocal ? definitionUrl.substring(6) : null;
		const sharedAccess =
			isLocal && guid
				? await tryResolveShareToken(request, url, guid, channel, { requireSolve: true })
				: null;

		if (!sharedAccess && (!locals.ctx || !locals.user)) {
			throw error(401, 'Unauthorized');
		}

		// Synthetic for token-resolved, user's context otherwise.
		const solveCtx: RequestContext = sharedAccess?.ctx ?? locals.ctx!;

		// Per-key rate limit; runs before DB reads so throttled callers don't burn quota.
		const rateLimitKey = sharedAccess ? `share:${sharedAccess.link.id}` : `user:${locals.user!.id}`;
		const rateLimit = checkComputeRateLimit(rateLimitKey);
		if (!rateLimit.allowed) {
			const retryAfter = rateLimit.retryAfter ?? 1;
			return new Response(
				JSON.stringify({
					message: `Too many compute requests. Retry in ${retryAfter}s.`,
					retryAfter
				}),
				{
					status: 429,
					headers: {
						'Content-Type': 'application/json',
						'Retry-After': String(retryAfter)
					}
				}
			);
		}

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
			definitionPin = record.computeServerId ?? null;

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
			localVersionForBackfill = { id: version.id, hasSchema: version.schema !== undefined };

			try {
				const bytes = await storage.get(version.fileKey);
				if (!bytes) throw new Error(`Version blob missing: ${version.fileKey}`);
				definitionSource = bytes;
			} catch (err) {
				console.error(`Failed to load local definition blob: ${guid}`, err);
				throw error(404, `Definition '${guid}' not found`);
			}
		} else {
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

		// Atomic check-and-increment (spec §7); run before solve to avoid wasting compute.
		if (sharedAccess) {
			const next = await providers.data.shareLinks.tryIncrementSolveCount(
				solveCtx,
				sharedAccess.link.id
			);
			if (next === null) {
				throw error(429, 'Share link solve cap reached.');
			}
		}

		const serverConfig = await resolveServerForOrg(solveCtx, solveOrgId, { definitionPin });

		// BRIDGE: remove ~2026-09 — lazy backfill for pre-cached versions. Best-effort.
		if (localVersionForBackfill && !localVersionForBackfill.hasSchema) {
			const versionId = localVersionForBackfill.id;
			try {
				const schema = await fetchSchemaFromCompute(definitionSource, serverConfig);
				await providers.data.definitions.setVersionSchema(solveCtx, versionId, schema);
			} catch (err) {
				console.warn(`[API/Compute] Schema backfill failed for version ${versionId}:`, err);
			}
		}

		const { scheduler } = await getClient(serverConfig);

		// request.signal propagates to Compute; abort kills orphan solves.
		let solvedDefinition;
		try {
			solvedDefinition = await scheduler.solve(definitionSource, inputTree, {
				signal: request.signal
			});
		} catch (err) {
			// Distinguish timeout (scheduler timer) from client disconnect (request signal).
			if (err instanceof Error && err.name === 'AbortError') {
				if (request.signal.aborted) {
					throw error(499, 'Client closed request');
				}
				throw error(
					504,
					`Solve exceeded the ${Math.round(MAX_SOLVE_DURATION_MS / 1000)}s deadline.`
				);
			}
			throw err;
		}

		// Stringify once to measure and catch V8 RangeError on oversized strings.
		let serialized: string;
		try {
			serialized = JSON.stringify(solvedDefinition);
		} catch (err) {
			if (err instanceof RangeError) {
				throw error(
					413,
					'Solve result is too large to return. This usually means a file output exceeds the supported size.'
				);
			}
			throw err;
		}
		if (serialized.length > COMPUTE_RESPONSE_MAX_BYTES) {
			throw error(
				413,
				'Solve result is too large to return. This usually means a file output exceeds the supported size.'
			);
		}
		return new Response(serialized, {
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err) {
		if (isHttpError(err)) throw err;

		if (err instanceof ComputeServerUnconfiguredError) {
			throw error(503, err.message);
		}

		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[API/Compute] Error:', message);

		if (err instanceof TypeError && message === 'fetch failed') {
			throw error(503, 'Compute server is unreachable');
		}

		throw error(500, message);
	}
};
