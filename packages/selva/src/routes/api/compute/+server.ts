import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { isHttpError } from '@sveltejs/kit';
import type { RequestContext, SolveFailureKind } from '@selvajs/platform';
import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { getClient, COMPUTE_DEBUG } from '$lib/server/compute/clientCache.server';
import { loadRemoteDefinition } from '$lib/server/compute/remoteDefinition.server';
import { definitionRef } from '$lib/server/compute/definitionByteCache.server';
import {
	buildSolveCacheHook,
	resolveSolveCacheQuota,
	solveCacheSingleFlight,
	solveCacheStats
} from '$lib/server/compute/solveCache.server';
import { definitionByteCacheStats } from '$lib/server/compute/definitionByteCache.server';
import {
	runSolvePipeline,
	type PipelineInput,
	type ByteCacheRef,
	type SolvePipelineCacheHook
} from '@selvajs/server/compute';
import { stableStringify, type SolveDefinition } from '@selvajs/compute';
import { checkComputeRateLimit } from '$lib/server/computeRateLimit.server';
import {
	COMPUTE_REQUEST_MAX_BYTES,
	COMPUTE_RESPONSE_MAX_BYTES,
	MAX_SOLVE_DURATION_MS
} from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { getStorageProvider, getSolveMetricSink, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';

interface ComputeRequest {
	inputs: PipelineInput[];
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

// The transport-agnostic solve pipeline (input tree build → solve → serialize +
// gzip + Server-Timing envelope) lives in `@selvajs/server` (`runSolvePipeline`);
// this route keeps the app policy around it (auth, DB reads, share tokens, rate
// limit, metric sink, schema backfill). The remote-definition fetch (SSRF guard
// + cap + TTL) and the per-server warm-client cache are likewise imported.

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

		// Local definitions solve by reference: a byte-cache `DefinitionRef` whose
		// bytes the scheduler loads ONLY when an upload is unavoidable (pointer-known
		// re-solves move zero bytes). Remote-URL definitions carry raw fetched bytes.
		let definitionSource: SolveDefinition;
		// The byte-cache ref for a local solve — its `.load()` materializes bytes for
		// schema backfill, and its `.outcome` drives the `def_bytes` Server-Timing
		// verdict. Null for remote-URL solves (raw bytes, no ref).
		let localDefinitionRef: ByteCacheRef | null = null;
		// BRIDGE: remove ~2026-09 — lazy schema backfill for pre-cached versions.
		let localVersionForBackfill: { id: string; hasSchema: boolean } | null = null;
		// BYO compute routing per org (spec §3); null for remote definitions.
		let solveOrgId: string | null = null;
		// Per-definition compute pin (spec §3 step 1).
		let definitionPin: string | null = null;
		// Solve-metric attribution; null for remote-URL solves.
		let metricDefinitionId: string | null = null;
		let metricVersionId: string | null = null;
		// Definition's resolved L2 cache quota (H1). 0 = caching off; set only for
		// local solves. Consulted when building the pipeline's L2 hook below.
		let solveCacheQuota = 0;

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
			getSolveMetricSink()
				.record(solveCtx, {
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
				})
				// Sinks are contracted not to throw, but nothing enforces it — a bad sink
				// must surface as a log line, not an unhandled rejection.
				.catch((err) => console.error('[API/Compute] solve-metric record failed:', err));
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
			solveCacheQuota = resolveSolveCacheQuota(record.solveCacheLimit);
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

			// Solve by reference: the scheduler materializes bytes lazily (only on an
			// unavoidable upload), and the byte cache serves a warm entry without
			// touching storage. Keyed on the immutable version id — NEVER the fileKey,
			// which a delete-latest-then-reupload can reuse for different content. A
			// missing blob now surfaces at solve time (compute_error → 500) rather than
			// as an upfront 404, since we no longer eagerly read it here.
			localDefinitionRef = definitionRef(version.id, async () => {
				const bytes = await storage.get(version.fileKey);
				if (!bytes) throw new Error(`Version blob missing: ${version.fileKey}`);
				return bytes;
			});
			definitionSource = localDefinitionRef;
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
		// the "load" phase; the tree build + solve are measured inside the pipeline.
		const defLoadMs = performance.now() - loadStart;

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
		if (localVersionForBackfill && !localVersionForBackfill.hasSchema && localDefinitionRef) {
			const versionId = localVersionForBackfill.id;
			try {
				// Schema extraction needs real bytes — materialize through the byte
				// cache (warms the entry the upcoming solve's `load()` would hit).
				const bytes = await localDefinitionRef.load();
				const schema = await fetchSchemaFromCompute(bytes, serverConfig);
				await providers.data.definitions.setVersionSchema(solveCtx, versionId, schema);
			} catch (err) {
				console.warn(`[API/Compute] Schema backfill failed for version ${versionId}:`, err);
			}
			// Backfill calls the compute server — seconds when it fires. If this shows
			// up repeatedly for the same definition, setVersionSchema isn't sticking.
			mark('schemaBackfill');
		}

		// Definition-guid affinity key on the wire (ADR 0004 D2). Local definitions
		// carry a guid; remote-URL solves have none, so the header is simply absent.
		const client = await getClient(serverConfig, { definitionGuid: guid ?? undefined });
		mark('client');

		// Durable L2 solve cache (H1). Only live-channel local solves are cached
		// (channel decision 4): drafts iterate a handful of times then abandon, and
		// an explicit version pick is an editor preview — both skip L2. The hook is
		// null when caching is off (backend off / quota 0 / no org), and a null hook
		// means the pipeline never touches L2 (channel gate by hook presence).
		const cacheable = channel === 'live' && !explicitVersionId && metricVersionId !== null;
		const solveCache: SolvePipelineCacheHook | null = cacheable
			? buildSolveCacheHook({
					ctx: solveCtx,
					orgId: solveOrgId,
					definitionId: metricDefinitionId!,
					versionId: metricVersionId!,
					quota: solveCacheQuota,
					// Fold the compute server identity into the key (R8): two servers can
					// run different Rhino/plugin versions yielding different geometry.
					configSubset: { computeServerId: serverConfig.id }
				})
			: null;

		// Single-flight (R4): coalesce concurrent identical live solves into one
		// pipeline execution so a hot-key burst hits compute once. Keyed on the same
		// identity the L2 keys on (org + version + inputs). An uncacheable solve
		// (draft / remote / explicit version) gets a unique key, so single-flight is a
		// no-op there and each keeps its own request.signal (R3 orphan-cancel).
		const coalesced = solveCache != null && metricVersionId != null;
		const coalesceKey = coalesced
			? `${solveOrgId}:${metricVersionId}:${stableStringify({ inputs, values })}`
			: `nocoalesce:${metricVersionId ?? definitionUrl}:${performance.now()}:${Math.round(Math.random() * 1e9)}`;

		// A coalesced solve is shared: if it followed one caller's request.signal, that
		// caller disconnecting would abort the solve for EVERY waiter (a spurious 499).
		// So a coalesced run gets a non-aborting signal — it runs to completion,
		// populates L2, and every waiter is served the same result. Uncoalesced solves
		// keep request.signal so a disconnect still cancels the orphan compute (R3).
		const solveSignal = coalesced ? new AbortController().signal : request.signal;

		// Hand off to the transport-agnostic pipeline: input tree build → L2 lookup →
		// solve (signal propagates to Compute) → serialize + gzip + L2 write-through +
		// Server-Timing envelope. Returns a typed outcome we map to metrics + HTTP
		// status; never throws for an expected failure.
		const outcome = await solveCacheSingleFlight.run(coalesceKey, () =>
			runSolvePipeline({
				definitionSource,
				byteRefOutcome: localDefinitionRef?.outcome,
				inputs,
				values,
				client,
				responseMaxBytes: COMPUTE_RESPONSE_MAX_BYTES,
				maxSolveDurationMs: MAX_SOLVE_DURATION_MS,
				acceptEncoding: request.headers.get('accept-encoding') ?? '',
				signal: solveSignal,
				loadStartMs: loadStart,
				defLoadMs,
				prepMarks,
				solveCache: solveCache ?? undefined
			})
		);

		// Map the pipeline's expected-failure outcomes to metrics + HTTP status.
		// Each `apiError` throws (returns `never`), so past this block `outcome` is
		// narrowed to the `ok` variant.
		if (outcome.kind === 'timeout') {
			recordMetric('timeout', { durationMs: outcome.durationMs });
			apiError(504, ApiErrorCode.INTERNAL, outcome.message);
		}
		if (outcome.kind === 'client_abort') {
			recordMetric('client_abort', { durationMs: outcome.durationMs });
			apiError(499, ApiErrorCode.INTERNAL, 'Client closed request');
		}
		if (outcome.kind === 'too_large') {
			recordMetric('too_large');
			apiError(
				413,
				ApiErrorCode.INTERNAL,
				'Solve result is too large to return. This usually means a file output exceeds the supported size.'
			);
		}
		if (outcome.kind === 'shed') {
			// Scheduler backpressure shed this solve before it ran (queue full or
			// queue-wait deadline). 503 + Retry-After so the client backs off and
			// retries — a fast fail, not a hung request. Built as a raw Response
			// because apiError can't set Retry-After.
			recordMetric('shed', { durationMs: outcome.durationMs });
			return new Response(
				JSON.stringify({ message: outcome.message, retryAfter: outcome.retryAfterSeconds }),
				{
					status: 503,
					headers: {
						'Content-Type': 'application/json',
						'Retry-After': String(outcome.retryAfterSeconds)
					}
				}
			);
		}
		if (outcome.kind === 'compute_error') {
			// Re-throw so the outer catch maps `fetch failed` → 503 and everything
			// else → 500, preserving the pre-extraction error handling.
			throw outcome.error;
		}

		// Success. Record the metric and bump the definition's display counter.
		recordMetric('ok', {
			durationMs: outcome.solveMs,
			errorCount: outcome.errorCount,
			warningCount: outcome.warningCount
		});
		// Bump the definition's display counter ("N runs"). Local definitions only —
		// remote URLs have no record. Best-effort: the solve already succeeded and
		// was returned, so a failed counter write must not turn into a request
		// error. Share-link cap counting is separate (above).
		if (metricDefinitionId) {
			providers.data.definitions
				.incrementSolveCount(solveCtx, metricDefinitionId)
				.catch((err) =>
					console.warn(`[API/Compute] solveCount increment failed for ${metricDefinitionId}:`, err)
				);
		}

		const { envelope } = outcome;
		const { metrics } = envelope;
		// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the server-side overhead the solve metric's
		// `durationMs` doesn't capture. `load` = auth + DB + definition fetch; `tree` =
		// input tree build; `serialize` = JSON.stringify of the result. The solve itself
		// is timed separately (see the solve metric's durationMs and [Compute/selva-cache]).
		if (COMPUTE_DEBUG) {
			console.info(
				`[Compute/server] load=${defLoadMs.toFixed(0)}ms tree=${metrics.treeBuildMs.toFixed(0)}ms ` +
					`solve=${metrics.solveMs.toFixed(0)}ms serialize=${metrics.serializeMs.toFixed(0)}ms ` +
					`gzip=${metrics.gzipMs.toFixed(0)}ms total=${metrics.serverTotalMs.toFixed(0)}ms | result=${formatBytes(metrics.serializedBytes)}`
			);
			if (metrics.compressedBytes !== null) {
				console.info(
					`[Compute/server] gzip ${formatBytes(metrics.serializedBytes)} → ${formatBytes(metrics.compressedBytes)} ` +
						`(${(metrics.serializedBytes / metrics.compressedBytes).toFixed(1)}×)`
				);
			} else {
				// If this fires for browser requests, a proxy in front is stripping
				// Accept-Encoding — compression is then impossible end-to-end from here.
				const acceptEncoding = request.headers.get('accept-encoding') ?? '';
				console.info(
					`[Compute/server] compression skipped — Accept-Encoding: "${acceptEncoding || '(absent)'}"`
				);
			}
			// Names the step a `load` (or pre-solve) spike hides in.
			console.info(
				`[Compute/server] prep breakdown: ` +
					prepMarks.map(([label, ms]) => `${label}=${ms.toFixed(0)}ms`).join(' ')
			);
			// Aggregate cache counters — the only place evictions/quota-drops surface
			// (per-request Server-Timing only carries hit/miss verdicts).
			const l2 = solveCacheStats();
			if (l2) {
				console.info(
					`[Compute/l2-cache] hits=${l2.hits} misses=${l2.misses} writes=${l2.writes} ` +
						`quotaEvictions=${l2.quotaEvictions} byteEvictions=${l2.byteEvictions} ` +
						`entries=${l2.entries} retained=${formatBytes(l2.bytes)}`
				);
			}
			const db = definitionByteCacheStats();
			console.info(
				`[Compute/def-bytes] hits=${db.hits} misses=${db.misses} evictions=${db.evictions} ` +
					`entries=${db.entries} retained=${formatBytes(db.bytes)}`
			);
		}

		// `body` is a `Uint8Array` (gzip) or the JSON `string`; both are valid
		// BodyInit at runtime. The union widens past the DOM lib's BodyInit type, so
		// hand `Response` the concrete branch.
		return new Response(
			typeof envelope.body === 'string' ? envelope.body : new Uint8Array(envelope.body),
			{ headers: envelope.headers }
		);
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
