import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { TreeBuilder } from '@selvajs/compute';
import type { SchemaInput } from '@selvajs/schemas';
import { isHttpError } from '@sveltejs/kit';
import type { RequestContext, SolveFailureKind } from '@selvajs/platform';
import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import {
	getClient,
	COMPUTE_DEBUG,
	type CachedClient
} from '$lib/server/compute/clientCache.server';
import { assertSafeRemoteDefinitionUrl, transformInputParameter } from '@selvajs/server/compute';
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
import { getStorageProvider, getSolveMetricSink, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';
import { gzipSync } from 'node:zlib';

interface ComputeRequest {
	inputs: (SchemaInput & { minimum?: number; maximum?: number; stepSize?: number })[];
	values: Record<string, unknown>;
	definitionUrl: string;
	/** Spec §6 channel selector. Defaults to 'live'. 'draft' requires editor. */
	channel?: 'live' | 'draft';
	/**
	 * Explicit version pick (versioning tab "Run"). Solves this exact version
	 * instead of the channel pointer; editor-only, never share-token accessible.
	 */
	versionId?: string;
}

/** Human-readable byte size for debug logs (e.g. 1536 -> "1.5 KB"). */
function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// -----------------------------
// Caching infrastructure
// -----------------------------

/** Cache for remote definitions (URL -> bytes). TTL/caps come from computeLimits. */
const definitionCache = new Map<string, { data: Uint8Array; fetchedAt: number }>();

// The per-server client+scheduler cache moved to
// `$lib/server/compute/clientCache.server` (`getClient`) so the render path
// shares the same warm clients — imported above.

// Read a response body into memory, aborting (and throwing) as soon as the
// running byte total exceeds `maxBytes`. Falls back to `arrayBuffer()` only
// when the body isn't a readable stream (older fetch impls).
async function readBodyWithCap(
	response: Response,
	maxBytes: number,
	controller: AbortController
): Promise<Uint8Array> {
	if (!response.body) {
		const buffer = await response.arrayBuffer();
		if (buffer.byteLength > maxBytes) throw new Error('Remote definition exceeds size limit');
		return new Uint8Array(buffer);
	}

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			controller.abort();
			throw new Error('Remote definition exceeds size limit');
		}
		chunks.push(value);
	}

	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

// SSRF checks: literal + DNS host validation, redirect:'error', size caps, timeout.
async function loadRemoteDefinition(url: string): Promise<Uint8Array> {
	// Resolves the host and rejects when any resolved IP is private/loopback/
	// link-local — covers literal-encoding bypasses (integer/octal/hex/short-form,
	// IPv4-mapped IPv6) and public names that point inward. Throws on rejection.
	await assertSafeRemoteDefinitionUrl(url);

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
		// Reject early when the server declares an oversized body.
		const declared = Number(response.headers.get('content-length'));
		if (Number.isFinite(declared) && declared > REMOTE_DEFINITION_MAX_BYTES) {
			throw new Error('Remote definition exceeds size limit');
		}
		// Stream and count rather than `arrayBuffer()` — a missing/lying
		// content-length must not let an unbounded body buffer into memory
		// before the cap is checked. Abort the moment we cross the limit.
		data = await readBodyWithCap(response, REMOTE_DEFINITION_MAX_BYTES, controller);
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

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const storage = getStorageProvider();

	// Reject oversized payloads before buffering.
	requireMaxBodySize(request, COMPUTE_REQUEST_MAX_BYTES);

	// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): start of server-side work. The solve metric's
	// `durationMs` wraps ONLY scheduler.solve, so everything before it (auth, DB reads,
	// definition fetch, input tree build) and the response serialization after it are
	// otherwise invisible. We time those phases and log a breakdown below.
	const loadStart = performance.now();

	// Sub-phase marks for the pre-solve "prep" work (body parse, share token, DB
	// reads, blob fetch, compute-server resolve …). Each mark records time since
	// the previous one, so the sequence names exactly which step a `load` spike
	// hides in. Exposed as `p_*` entries on the Server-Timing header and echoed
	// in the debug log — observed load varying 0.05s–9.6s for the same definition.
	const prepMarks: [string, number][] = [];
	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	try {
		const body: ComputeRequest = await request.json();
		mark('body');

		const { inputs, values } = body;
		const definitionUrl = body.definitionUrl;
		const channel: 'live' | 'draft' = body.channel ?? 'live';
		const explicitVersionId = body.versionId ?? null;

		if (!inputs || !values || !definitionUrl) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				'Missing required fields: inputs, values, or definitionUrl'
			);
		}
		if (channel !== 'live' && channel !== 'draft') {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				`Invalid channel: ${channel}. Must be 'live' or 'draft'.`
			);
		}

		let definitionSource: Uint8Array;
		// BRIDGE: remove ~2026-09 — lazy schema backfill for pre-cached versions.
		let localVersionForBackfill: { id: string; hasSchema: boolean } | null = null;
		// BYO compute routing per org (spec §3); null for remote definitions.
		let solveOrgId: string | null = null;
		// Per-definition compute pin (spec §3 step 1).
		let definitionPin: string | null = null;
		// Solve-metric attribution; null for remote-URL solves.
		let metricDefinitionId: string | null = null;
		let metricVersionId: string | null = null;

		// Share-link tokens (spec §7); null for remote definitions or no token.
		const isLocal = definitionUrl.startsWith('local:');
		const guid = isLocal ? definitionUrl.substring(6) : null;
		// Explicit-version solves are editor-only, so don't resolve a share token
		// for them — force the logged-in editor gate below.
		const sharedAccess =
			isLocal && guid && !explicitVersionId
				? await tryResolveShareToken(request, url, guid, channel, { requireSolve: true })
				: null;
		mark('shareToken');

		if (!sharedAccess && (!locals.ctx || !locals.user)) {
			apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
		}

		// Synthetic for token-resolved, user's context otherwise.
		const solveCtx: RequestContext = sharedAccess?.ctx ?? locals.ctx!;

		// One row per solve attempt — including attempts rejected before the solve
		// runs. Reads the attribution `let`s at call time so each record captures
		// whatever has resolved so far (definition/version are null pre-resolution).
		// Fire-and-forget; the sink never throws (ISolveMetricSink contract).
		const recordMetric = (
			failureKind: SolveFailureKind,
			extra: { durationMs?: number; errorCount?: number; warningCount?: number } = {}
		) => {
			void getSolveMetricSink().record(solveCtx, {
				definitionUrl,
				definitionId: metricDefinitionId,
				versionId: metricVersionId,
				channel,
				orgId: solveOrgId,
				durationMs: extra.durationMs ?? 0,
				ok: failureKind === 'ok',
				failureKind,
				errorCount: extra.errorCount ?? 0,
				warningCount: extra.warningCount ?? 0
			});
		};

		// Per-key rate limit; runs before DB reads so throttled callers don't burn quota.
		const rateLimitKey = sharedAccess ? `share:${sharedAccess.link.id}` : `user:${locals.user!.id}`;
		const rateLimit = checkComputeRateLimit(rateLimitKey);
		if (!rateLimit.allowed) {
			recordMetric('rate_limited');
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
				apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' not found`);
			}
			if (!record) apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' not found`);
			mark('defRecord');

			const project = await providers.data.projects.getProject(solveCtx, record.projectId);
			solveOrgId = project?.orgId ?? null;
			definitionPin = record.computeServerId ?? null;
			mark('project');

			if (!sharedAccess) {
				if (channel === 'draft' || explicitVersionId) {
					await requireCanEditDefinition(locals, record.projectId, guid, {
						project,
						definition: record
					});
				} else {
					await requireCanSolve(locals, record.projectId, project ?? undefined);
				}
			}
			mark('access');

			const versionId =
				explicitVersionId ?? (channel === 'live' ? record.liveVersionId : record.draftVersionId);
			if (!versionId) {
				apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' has no ${channel} version yet`);
			}
			const version = await providers.data.definitions.getVersion(solveCtx, versionId);
			if (!version || version.definitionId !== guid) {
				apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' version is missing`);
			}
			localVersionForBackfill = { id: version.id, hasSchema: version.schema !== undefined };
			metricDefinitionId = guid;
			metricVersionId = version.id;
			mark('version');

			try {
				const bytes = await storage.get(version.fileKey);
				if (!bytes) throw new Error(`Version blob missing: ${version.fileKey}`);
				definitionSource = bytes;
			} catch (err) {
				console.error(`Failed to load local definition blob: ${guid}`, err);
				apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' not found`);
			}
			mark('blob');
		} else {
			try {
				definitionSource = await loadRemoteDefinition(definitionUrl);
			} catch (err) {
				console.error(`Failed to fetch definition from ${definitionUrl}:`, err);
				apiError(
					400,
					ApiErrorCode.VALIDATION_FAILED,
					`Failed to load definition: ${err instanceof Error ? err.message : String(err)}`
				);
			}
			mark('remoteDef');
		}

		// Phase boundary: everything above (auth, DB, blob/remote definition fetch) is
		// the "load" phase; the tree build is measured on its own.
		const defLoadMs = performance.now() - loadStart;
		const treeBuildStart = performance.now();

		const inputTree = TreeBuilder.fromInputParams(
			inputs
				.filter((input) => input.paramType)
				.map((input) => transformInputParameter(input, values[input.id]))
		);
		const treeBuildMs = performance.now() - treeBuildStart;
		// Tree build is timed separately above — restart the mark clock so the next
		// prep mark doesn't absorb it.
		prevMark = performance.now();

		// Atomic check-and-increment (spec §7); run before solve to avoid wasting compute.
		if (sharedAccess) {
			const next = await providers.data.shareLinks.tryIncrementSolveCount(
				solveCtx,
				sharedAccess.link.id
			);
			if (next === null) {
				recordMetric('share_cap');
				apiError(429, ApiErrorCode.INTERNAL, 'Share link solve cap reached.');
			}
			mark('shareCap');
		}

		const serverConfig = await resolveServerForOrg(solveCtx, solveOrgId, { definitionPin });
		mark('resolveServer');

		// BRIDGE: remove ~2026-09 — lazy backfill for pre-cached versions. Best-effort.
		if (localVersionForBackfill && !localVersionForBackfill.hasSchema) {
			const versionId = localVersionForBackfill.id;
			try {
				const schema = await fetchSchemaFromCompute(definitionSource, serverConfig);
				await providers.data.definitions.setVersionSchema(solveCtx, versionId, schema);
			} catch (err) {
				console.warn(`[API/Compute] Schema backfill failed for version ${versionId}:`, err);
			}
			// Backfill calls the compute server — seconds when it fires. If this shows
			// up repeatedly for the same definition, setVersionSchema isn't sticking.
			mark('schemaBackfill');
		}

		const { scheduler, rhinoTiming, solveMeta } = await getClient(serverConfig);
		mark('client');

		// request.signal propagates to Compute; abort kills orphan solves.
		let solvedDefinition;
		let solveMs = 0;
		// Reset so a Selva-cache hit (no compute call) isn't attributed a stale
		// timing from an earlier request. See the rhinoTiming concurrency caveat.
		rhinoTiming.last = null;
		solveMeta.last = null;
		const solveStart = performance.now();
		try {
			solvedDefinition = await scheduler.solve(definitionSource, inputTree, {
				signal: request.signal
			});
			solveMs = performance.now() - solveStart;
			recordMetric('ok', {
				durationMs: solveMs,
				errorCount: solvedDefinition.errors?.length ?? 0,
				warningCount: solvedDefinition.warnings?.length ?? 0
			});
			// Bump the definition's display counter ("N runs"). Local definitions
			// only — remote URLs have no record. Best-effort: the solve already
			// succeeded and was returned, so a failed counter write must not turn
			// into a request error. Share-link cap counting is separate (above).
			if (metricDefinitionId) {
				providers.data.definitions
					.incrementSolveCount(solveCtx, metricDefinitionId)
					.catch((err) =>
						console.warn(
							`[API/Compute] solveCount increment failed for ${metricDefinitionId}:`,
							err
						)
					);
			}
		} catch (err) {
			// Distinguish timeout (scheduler deadline timer) from client disconnect
			// (request signal). AbortError with the request signal NOT aborted means
			// the scheduler's own timeout fired — the solve genuinely timed out.
			const isAbort = err instanceof Error && err.name === 'AbortError';
			const timedOut = isAbort && !request.signal.aborted;
			recordMetric(timedOut ? 'timeout' : isAbort ? 'client_abort' : 'compute_error', {
				durationMs: performance.now() - solveStart
			});
			if (isAbort) {
				if (request.signal.aborted) {
					apiError(499, ApiErrorCode.INTERNAL, 'Client closed request');
				}
				apiError(
					504,
					ApiErrorCode.INTERNAL,
					`Solve exceeded the ${Math.round(MAX_SOLVE_DURATION_MS / 1000)}s deadline.`
				);
			}
			throw err;
		}

		// Stringify once to measure and catch V8 RangeError on oversized strings.
		const serializeStart = performance.now();
		let serialized: string;
		try {
			serialized = JSON.stringify(solvedDefinition);
		} catch (err) {
			if (err instanceof RangeError) {
				recordMetric('too_large');
				apiError(
					413,
					ApiErrorCode.INTERNAL,
					'Solve result is too large to return. This usually means a file output exceeds the supported size.'
				);
			}
			throw err;
		}
		if (serialized.length > COMPUTE_RESPONSE_MAX_BYTES) {
			recordMetric('too_large');
			apiError(
				413,
				ApiErrorCode.INTERNAL,
				'Solve result is too large to return. This usually means a file output exceeds the supported size.'
			);
		}
		const serializeMs = performance.now() - serializeStart;
		// Gzip BEFORE the timing snapshot and header construction so its cost is a
		// measured phase (`gzip` in Server-Timing, included in `total`) — running it
		// after the snapshot silently inflated the browser's network≈ estimate by the
		// compression time. Buffered (not streamed) so Content-Length is known and a
		// connection cut mid-transfer fails hard instead of truncating the JSON.
		const acceptEncoding = request.headers.get('accept-encoding') ?? '';
		let compressed: Buffer | null = null;
		let gzipMs = 0;
		if (/\bgzip\b/i.test(acceptEncoding) && serialized.length > 1024) {
			const gzipStart = performance.now();
			compressed = gzipSync(Buffer.from(serialized));
			gzipMs = performance.now() - gzipStart;
		}
		// Total server-side wall time for this request (headers-out is imminent). The
		// difference between this and the browser's ttfb is request-send + network
		// latency; the difference between the browser's `download` and near-zero is the
		// payload transfer — this is how you find where a "16s with cached compute" goes.
		const serverTotalMs = performance.now() - loadStart;
		// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the server-side overhead the solve metric's
		// `durationMs` doesn't capture. `load` = auth + DB + definition fetch; `tree` =
		// input tree build; `serialize` = JSON.stringify of the result. The solve itself
		// is timed separately (see the solve metric's durationMs and [Compute/selva-cache]).
		if (COMPUTE_DEBUG) {
			console.info(
				`[Compute/server] load=${defLoadMs.toFixed(0)}ms tree=${treeBuildMs.toFixed(0)}ms ` +
					`solve=${solveMs.toFixed(0)}ms serialize=${serializeMs.toFixed(0)}ms ` +
					`gzip=${gzipMs.toFixed(0)}ms total=${serverTotalMs.toFixed(0)}ms | result=${formatBytes(serialized.length)}`
			);
			if (compressed) {
				console.info(
					`[Compute/server] gzip ${formatBytes(serialized.length)} → ${formatBytes(compressed.byteLength)} ` +
						`(${(serialized.length / compressed.byteLength).toFixed(1)}×)`
				);
			} else {
				// If this fires for browser requests, a proxy in front is stripping
				// Accept-Encoding — compression is then impossible end-to-end from here.
				console.info(
					`[Compute/server] compression skipped — Accept-Encoding: "${acceptEncoding || '(absent)'}"`
				);
			}
			// Names the step a `load` (or pre-solve) spike hides in.
			console.info(
				`[Compute/server] prep breakdown: ` +
					prepMarks.map(([label, ms]) => `${label}=${ms.toFixed(0)}ms`).join(' ')
			);
		}

		// Server-Timing header: the browser reads these to attribute its round-trip
		// (see [Compute/browser] in the library page). Standard header, small, always
		// sent — lets the frontend separate server work from network transfer without
		// enabling server debug logging. `total` here == the server's headers-to-out
		// wall time, so browser `ttfb − total` ≈ network+send latency.
		let serverTimingHeader =
			`load;dur=${defLoadMs.toFixed(1)}, ` +
			`tree;dur=${treeBuildMs.toFixed(1)}, ` +
			`solve;dur=${solveMs.toFixed(1)}, ` +
			`serialize;dur=${serializeMs.toFixed(1)}, ` +
			`gzip;dur=${gzipMs.toFixed(1)}, ` +
			`total;dur=${serverTotalMs.toFixed(1)}`;
		// When the compute server reported its own decode/solve/encode (Server-Timing
		// from the VektorNode fork), split the solve wall time further: rhino_* is time
		// ON the compute server; compute_link is everything between — network transfer
		// of the request+result between web server and Rhino.Compute, plus queue wait.
		// This is the compute↔web-server traffic time. Absent on Selva-cache hits.
		// Cast: TS narrows `last` to null from the pre-solve reset and can't see the
		// onServerTiming callback writing to it during the awaited solve.
		const rhino = rhinoTiming.last as CachedClient['rhinoTiming']['last'];
		if (rhino) {
			const onRhinoMs = rhino.decode + rhino.solve + rhino.encode;
			const computeLinkMs = Math.max(0, solveMs - onRhinoMs);
			serverTimingHeader +=
				`, rhino_decode;dur=${rhino.decode.toFixed(1)}` +
				`, rhino_solve;dur=${rhino.solve.toFixed(1)}` +
				`, rhino_encode;dur=${rhino.encode.toFixed(1)}` +
				`, compute_link;dur=${computeLinkMs.toFixed(1)}`;
		}
		// Prep sub-phases (p_*): the browser prints these as their own line, naming
		// the step behind a `load` spike without server log access.
		for (const [label, ms] of prepMarks) {
			serverTimingHeader += `, p_${label};dur=${ms.toFixed(1)}`;
		}
		// Cache verdicts as 0/1 flags (dur is the only Server-Timing value channel).
		// selva_cache=1 → served from Selva's response cache, compute never called.
		// def_reupload=1 → the full .gh was re-uploaded to the compute server.
		// Cast: same narrowing issue as rhinoTiming above.
		const settle = solveMeta.last as CachedClient['solveMeta']['last'];
		if (settle) {
			serverTimingHeader += `, selva_cache;dur=${settle.fromCache ? 1 : 0}`;
			if (settle.definitionReuploaded !== undefined) {
				serverTimingHeader += `, def_reupload;dur=${settle.definitionReuploaded ? 1 : 0}`;
			}
		}
		const responseHeaders: Record<string, string> = {
			'Content-Type': 'application/json',
			'Server-Timing': serverTimingHeader,
			Vary: 'Accept-Encoding'
		};

		// Body was compressed above (before the timing snapshot); Caddy's
		// `encode gzip` skips already-encoded responses, so this never
		// double-compresses. Vary is set on both branches for correct caching.
		if (compressed) {
			responseHeaders['Content-Encoding'] = 'gzip';
			responseHeaders['Content-Length'] = String(compressed.byteLength);
			return new Response(new Uint8Array(compressed), { headers: responseHeaders });
		}
		responseHeaders['Content-Length'] = String(Buffer.byteLength(serialized));
		return new Response(serialized, { headers: responseHeaders });
	} catch (err) {
		if (isHttpError(err)) throw err;

		if (err instanceof ComputeServerUnconfiguredError) {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
		}

		const message = err instanceof Error ? err.message : 'Unknown error';
		console.error('[API/Compute] Error:', message);

		if (err instanceof TypeError && message === 'fetch failed') {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server is unreachable');
		}

		apiError(500, ApiErrorCode.INTERNAL, message);
	}
};
