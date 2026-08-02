import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { isHttpError } from '@sveltejs/kit';
import type { RequestContext, SolveFailureKind } from '@selvajs/platform';
import {
	resolveServerForOrg,
	ComputeServerUnconfiguredError
} from '$lib/server/compute/resolve.server';
import { engine, COMPUTE_DEBUG } from '$lib/server/compute/engine.server';
import { loadRemoteDefinition } from '$lib/server/compute/remoteDefinition.server';
import type { ByteCacheRef, PipelineInput, SolveDefinition } from '@selvajs/solve/server';
import { checkComputeRateLimit } from '$lib/server/computeRateLimit.server';
import { COMPUTE_REQUEST_MAX_BYTES } from '$lib/server/computeLimits';
import { requireMaxBodySize } from '$lib/server/admin-auth.server';
import { getStorageProvider, getSolveMetricSink, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';
import { renderThrown } from '@selvajs/server/logging';

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

// The transport-agnostic solve mechanics (warm-client cache, definition-byte
// cache, single-flight coalescing, pipeline call, outcome→HTTP mapping) live in
// `@selvajs/solve/server`'s `SolveEngine` (`engine.server.ts`'s app-wide
// instance); this route keeps the app policy around it (auth, DB reads, share
// tokens, rate limit, metric sink, schema backfill). The remote-definition
// fetch (SSRF guard + cap + TTL) is likewise imported.

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
				.catch((err) =>
					locals.log.error('Solve-metric record failed', {
						component: 'API/Compute',
						err: renderThrown(err)
					})
				);
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
				locals.log.error('Failed to load local definition', {
					component: 'API/Compute',
					guid,
					err: renderThrown(err)
				});
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

			// Solve by reference: the scheduler materializes bytes lazily (only on an
			// unavoidable upload), and the byte cache serves a warm entry without
			// touching storage. Keyed on the immutable version id — NEVER the fileKey,
			// which a delete-latest-then-reupload can reuse for different content. A
			// missing blob now surfaces at solve time (compute_error → 500) rather than
			// as an upfront 404, since we no longer eagerly read it here.
			localDefinitionRef = engine.definitionRef(version.id, async () => {
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
				locals.log.error('Failed to fetch remote definition', {
					component: 'API/Compute',
					definitionUrl,
					err: renderThrown(err)
				});
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
				locals.log.warn('Schema backfill failed', {
					component: 'API/Compute',
					versionId,
					err: renderThrown(err)
				});
			}
			// Backfill calls the compute server — seconds when it fires. If this shows
			// up repeatedly for the same definition, setVersionSchema isn't sticking.
			mark('schemaBackfill');
		}

		// Hand off to the engine: warm-client lookup (stamping `definitionGuid` as the
		// ADR 0004 D2 affinity header when present), input-tree build, single-flight
		// coalescing (R4 — a hot-key burst hits compute once, for EVERY solve not just
		// cacheable ones), the abort/hasWaiters dance (R3 — a coalesced solve must not
		// follow one caller's disconnect and 499 every waiter), the pipeline call, and
		// per-caller Accept-Encoding re-keying (audit C5) all live in `SolveEngine.solve`
		// now. Remote-URL solves have no version id, so the URL stands in as their
		// coalesce-key identity (`definitionKey`); local solves carry that identity on
		// `localDefinitionRef.key` already, so `definitionKey` is unused there.
		const outcome = await engine.solve({
			server: serverConfig,
			definitionSource,
			definitionKey: isLocal ? undefined : definitionUrl,
			inputs,
			values,
			signal: request.signal,
			acceptEncoding: request.headers.get('accept-encoding') ?? '',
			definitionGuid: guid ?? undefined,
			loadStartMs: loadStart,
			defLoadMs,
			prepMarks
		});
		mark('solve');

		// Metric recording is app policy — the engine's `toResponse` only maps
		// outcome→HTTP. Branches don't return; `engine.toResponse` below does.
		if (outcome.kind === 'timeout') {
			recordMetric('timeout', { durationMs: outcome.durationMs });
		} else if (outcome.kind === 'client_abort') {
			recordMetric('client_abort', { durationMs: outcome.durationMs });
		} else if (outcome.kind === 'too_large') {
			recordMetric('too_large');
		} else if (outcome.kind === 'shed') {
			recordMetric('shed', { durationMs: outcome.durationMs });
		} else if (outcome.kind === 'ok') {
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
				providers.data.definitions.incrementSolveCount(solveCtx, metricDefinitionId).catch((err) =>
					locals.log.warn('solveCount increment failed', {
						component: 'API/Compute',
						definitionId: metricDefinitionId,
						err: renderThrown(err)
					})
				);
			}

			// DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the server-side overhead the solve metric's
			// `durationMs` doesn't capture. `load` = auth + DB + definition fetch; `tree` =
			// input tree build; `serialize` = JSON.stringify of the result. The solve itself
			// is timed separately (see the solve metric's durationMs and [Compute/selva-cache]).
			if (COMPUTE_DEBUG) {
				const { metrics } = outcome.envelope;
				locals.log.debug('Solve server-side phase breakdown', {
					component: 'Compute/server',
					loadMs: Math.round(defLoadMs),
					treeBuildMs: Math.round(metrics.treeBuildMs),
					solveMs: Math.round(metrics.solveMs),
					serializeMs: Math.round(metrics.serializeMs),
					gzipMs: Math.round(metrics.gzipMs),
					serverTotalMs: Math.round(metrics.serverTotalMs),
					serializedBytes: metrics.serializedBytes
				});
				if (metrics.compressedBytes !== null) {
					locals.log.debug('Response gzipped', {
						component: 'Compute/server',
						serializedBytes: metrics.serializedBytes,
						compressedBytes: metrics.compressedBytes,
						ratio: Number((metrics.serializedBytes / metrics.compressedBytes).toFixed(1))
					});
				} else {
					// If this fires for browser requests, a proxy in front is stripping
					// Accept-Encoding — compression is then impossible end-to-end from here.
					const acceptEncoding = request.headers.get('accept-encoding') ?? '';
					locals.log.debug('Compression skipped', {
						component: 'Compute/server',
						acceptEncoding,
						hasAcceptEncoding: acceptEncoding !== ''
					});
				}
				// Names the step a `load` (or pre-solve) spike hides in.
				locals.log.debug('Prep breakdown', {
					component: 'Compute/server',
					...Object.fromEntries(prepMarks.map(([label, ms]) => [`p_${label}Ms`, Math.round(ms)]))
				});
				// Aggregate cache counters — the only place evictions surface
				// (per-request Server-Timing only carries hit/miss verdicts).
				const db = engine.stats().definitionBytes;
				locals.log.debug('Definition byte-cache counters', {
					component: 'Compute/def-bytes',
					hits: db.hits,
					misses: db.misses,
					evictions: db.evictions,
					entries: db.entries,
					retainedBytes: db.bytes
				});
			}
		}

		// `toWebResponse` builds the Response itself (incl. `Retry-After` on `shed`,
		// which `apiError` cannot set) and still throws `compute_error` through to
		// the outer catch below.
		return engine.toWebResponse(outcome);
	} catch (err) {
		if (isHttpError(err)) throw err;

		if (err instanceof ComputeServerUnconfiguredError) {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
		}

		const message = err instanceof Error ? err.message : 'Unknown error';
		locals.log.error('Solve request failed', {
			component: 'API/Compute',
			err: renderThrown(err)
		});

		if (err instanceof TypeError && message === 'fetch failed') {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server is unreachable');
		}

		apiError(500, ApiErrorCode.INTERNAL, message);
	}
};
