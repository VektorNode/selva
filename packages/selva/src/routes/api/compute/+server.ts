import type { RequestHandler } from './$types';
import {
	type NumericInputType,
	type TextInputType,
	type BooleanInputType,
	type InputParam,
	TreeBuilder,
	GrasshopperClient,
	type SolveScheduler
} from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';
import { error, json, isHttpError } from '@sveltejs/kit';
import type { ComputeServerConfig, RequestContext } from '@selvajs/platform';
import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { isSafeRemoteDefinitionUrl } from '$lib/server/compute/safe-url';
import { checkComputeRateLimit } from '$lib/server/computeRateLimit.server';
import {
	COMPUTE_REQUEST_MAX_BYTES,
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

// -----------------------------
// Caching infrastructure
// -----------------------------

/** Cache for remote definitions (URL -> bytes). TTL/caps come from computeLimits. */
const definitionCache = new Map<string, { data: Uint8Array; fetchedAt: number }>();

/** Singleton GrasshopperClient + scheduler. The scheduler dedupes identical
 * (definition, dataTree) solves via an LRU cache and propagates AbortSignal
 * to the upstream Compute call so client disconnects kill orphan solves. */
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

	// Server identity changed — drop the old scheduler so its cache + in-flight
	// state don't leak across servers.
	cachedScheduler?.dispose();

	cachedClient = await GrasshopperClient.create({
		serverUrl: currentConfig.serverUrl,
		apiKey: currentConfig.apiKey
	});
	// `mode: 'queue'` because each HTTP request is its own caller — we never
	// want one user's solve to be superseded by another's. The dedup we want
	// is response caching, which is independent of mode.
	cachedScheduler = cachedClient.createScheduler({
		mode: 'queue',
		timeoutMs: MAX_SOLVE_DURATION_MS,
		cache: { maxEntries: 20, ttlMs: 5 * 60_000 }
	});
	cachedClientConfig = currentConfig;
	return { client: cachedClient, scheduler: cachedScheduler };
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

	// Per-route body cap — see `COMPUTE_REQUEST_MAX_BYTES` for rationale.
	// Runs BEFORE `request.json()` so a too-large declared payload is
	// rejected without buffering.
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
		// BRIDGE: remove ~2026-09 — see specs/SchemaCaching.md. Holds the local
		// version row so we can lazily backfill its cached schema post-solve.
		let localVersionForBackfill: { id: string; hasSchema: boolean } | null = null;
		// Track which org owns the definition so BYO compute can route the solve
		// to that org's override server (spec §3). Null when the definition is
		// externally hosted — no tenant context, fall through to global default.
		let solveOrgId: string | null = null;
		// Per-definition compute pin (spec §3 step 1). Falls through silently if
		// the pinned server is no longer visible to the project's org.
		let definitionPin: string | null = null;

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

		// Per-key rate limit. `share:{linkId}` for token-credentialed solves
		// (each link has its own bucket so anonymous consumers of one link
		// don't share quota with the link's owner); `user:{userId}` otherwise.
		// Runs BEFORE definition + version reads so we don't burn DB on
		// already-throttled callers.
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

		const serverConfig = await resolveServerForOrg(solveCtx, solveOrgId, { definitionPin });

		// BRIDGE: remove ~2026-09 — see specs/SchemaCaching.md. New uploads cache
		// their schema at upload; versions predating that have none. Backfill it
		// here, lazily, the first time such a version is solved. Best-effort: a
		// failure must never block or fail the solve.
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

		// The scheduler propagates `request.signal` to the Compute call, so a
		// client disconnect aborts the upstream solve instead of orphaning it.
		// Timeout is enforced by the scheduler (MAX_SOLVE_DURATION_MS); on
		// overrun the scheduler rejects with an abort error which we map to 504.
		let solvedDefinition;
		try {
			solvedDefinition = await scheduler.solve(definitionSource, inputTree, {
				signal: request.signal
			});
		} catch (err) {
			// Distinguish timeout from caller-disconnect. The scheduler raises
			// AbortError for both; the timer firing first means we hit the
			// deadline, the request signal firing first means the client left.
			if (err instanceof Error && err.name === 'AbortError') {
				if (request.signal.aborted) {
					// Client gave up; don't bother responding with a useful body.
					throw error(499, 'Client closed request');
				}
				throw error(
					504,
					`Solve exceeded the ${Math.round(MAX_SOLVE_DURATION_MS / 1000)}s deadline.`
				);
			}
			throw err;
		}

		return json(solvedDefinition);
	} catch (err) {
		// Re-throw SvelteKit errors (400, 404, etc.) as-is
		if (isHttpError(err)) throw err;

		// No compute server configured/visible — an operator action, not a bug.
		if (err instanceof ComputeServerUnconfiguredError) {
			throw error(503, err.message);
		}

		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[API/Compute] Error:', message);

		// Distinguish connectivity errors from other failures
		if (err instanceof TypeError && message === 'fetch failed') {
			throw error(503, 'Compute server is unreachable');
		}

		throw error(500, message);
	}
};
