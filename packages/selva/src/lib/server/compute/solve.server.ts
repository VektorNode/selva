/**
 * The body-independent core of a solve request, shared by `POST /api/v1/compute`
 * (share-token and remote-URL capable) and `POST /api/v1/definitions/{guid}/solve`
 * (tenant-scoped, cookie or PAT).
 *
 * **Share-token resolution stays outside this module, in the route.** The caller
 * hands in an already-decided `SolveAccess`; the definition-addressed route only
 * ever constructs the `user` variant, so it cannot inherit the anonymous branch
 * by accident. Adding a token lookup here would silently give it one.
 *
 * What lives here: rate limiting, definition/version resolution, access checks,
 * compute-server routing, schema backfill, the engine call, metric recording, the
 * debug breakdown. What stays in a route: parsing its own body shape and deciding
 * who the caller is.
 */

import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { isApiError } from '@selvajs/server/api';
import { isHttpError } from '@sveltejs/kit';
import { ComputeError, ErrorCodes } from '@selvajs/compute/core';
import type { RequestContext, SolveFailureKind } from '@selvajs/platform';
import { resolveServerForOrg, ComputeServerUnconfiguredError } from '@selvajs/server/compute';
import { engine, COMPUTE_DEBUG } from '$lib/server/compute/engine.server';
import { loadRemoteDefinition } from '$lib/server/compute/remoteDefinition.server';
import type {
	ByteCacheRef,
	PipelineInput,
	SolveDefinition,
	SolveEnvelope
} from '@selvajs/solve/server';
import { checkComputeRateLimit } from '$lib/server/computeRateLimit.server';
import { getStorageProvider, getSolveMetricSink, providers } from '$lib/server/providers.server';
import { requireCanSolve, requireCanEditDefinition, scoped } from '$lib/server/access.server';
import { fetchSchemaFromCompute } from '@selvajs/server/definitions';
import { renderThrown } from '@selvajs/server/logging';
import type { ShareLink } from '@selvajs/platform';

export type SolveChannel = 'live' | 'draft';

/**
 * Who is solving, and under whose authority.
 *
 * `user` — a logged-in caller; the per-definition access rules run.
 * `share` — a share-link token; the token already encodes the grant, so the
 * rules are skipped and the link's solve cap is charged instead.
 */
export type SolveAccess =
	| { kind: 'user'; ctx: RequestContext; rateLimitKey: string }
	| { kind: 'share'; ctx: RequestContext; link: ShareLink; rateLimitKey: string };

export interface SolveParams {
	access: SolveAccess;
	definitionUrl: string;
	inputs: PipelineInput[];
	values: Record<string, unknown>;
	channel: SolveChannel;
	/** Explicit version pick; editor-only, never share-token accessible. */
	versionId: string | null;
	request: Request;
	/** Typed loosely: two route trees with different generated `$types` both call this. */
	locals: App.Locals;
	/** `performance.now()` at the very start of the request, before body parse. */
	loadStart: number;
	/** Prep sub-phase timings recorded before this call (body parse, token). */
	prepMarks: [string, number][];
	/**
	 * Report an access refusal as 404 instead of 403.
	 *
	 * The definition-addressed route needs this: a guid is guessable, so
	 * 403-vs-404 there tells a caller whether a definition they cannot reach
	 * exists. `/api/v1/compute` leaves it off — its callers navigated to the
	 * definition, and a 403 is the more useful answer.
	 */
	concealAccessFailure?: boolean;
}

/**
 * Run a solve and return the HTTP response.
 *
 * Throws `HttpError` (via `apiError`) for every refusal, and lets engine/network
 * failures propagate for the caller's outer catch to map — the two routes share
 * that mapping through `mapSolveError`.
 */
export async function runSolve(params: SolveParams): Promise<Response> {
	const {
		access,
		definitionUrl,
		inputs,
		values,
		channel,
		versionId: explicitVersionId,
		request,
		locals,
		loadStart,
		prepMarks,
		concealAccessFailure = false
	} = params;
	const storage = getStorageProvider();
	const sharedAccess = access.kind === 'share' ? access : null;
	const solveCtx = access.ctx;

	let prevMark = performance.now();
	const mark = (label: string) => {
		prepMarks.push([label, performance.now() - prevMark]);
		prevMark = performance.now();
	};

	// Local definitions solve by reference: a byte-cache `DefinitionRef` whose
	// bytes the scheduler loads ONLY when an upload is unavoidable (pointer-known
	// re-solves move zero bytes). Remote-URL definitions carry raw fetched bytes.
	let definitionSource: SolveDefinition;
	// `.load()` materializes bytes for schema backfill; `.outcome` drives the
	// `def_bytes` Server-Timing verdict. Null for remote-URL solves.
	let localDefinitionRef: ByteCacheRef | null = null;
	let localVersionForBackfill: { id: string; hasSchema: boolean } | null = null;
	// BYO compute routing per org; null for remote definitions.
	let solveOrgId: string | null = null;
	let definitionPin: string | null = null;
	// Solve-metric attribution; null for remote-URL solves.
	let metricDefinitionId: string | null = null;
	let metricVersionId: string | null = null;

	const isLocal = definitionUrl.startsWith('local:');
	const guid = isLocal ? definitionUrl.substring(6) : null;

	// One row per solve attempt, including attempts rejected before the solve
	// runs — reads the attribution `let`s at call time, so definition/version
	// are null when a record fires pre-resolution. Fire-and-forget: the sink
	// never throws (ISolveMetricSink contract).
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
	const rateLimit = checkComputeRateLimit(access.rateLimitKey);
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
			try {
				if (channel === 'draft' || explicitVersionId) {
					await requireCanEditDefinition(scoped(locals), record.projectId, guid, {
						project,
						definition: record
					});
				} else {
					await requireCanSolve(scoped(locals), record.projectId, project ?? undefined);
				}
			} catch (err) {
				// The guards raise `ApiError`, but `requireCanEditDefinition` may still
				// surface an `HttpError` — matching only one shape would let the
				// other's 403 leak through, confirming a guid the caller can't reach.
				const status = isApiError(err) ? err.status : isHttpError(err) ? err.status : undefined;
				if (concealAccessFailure && status === 403) {
					apiError(404, ApiErrorCode.NOT_FOUND, `Definition '${guid}' not found`);
				}
				throw err;
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

		// Keyed on the immutable version id, NEVER the fileKey — a
		// delete-latest-then-reupload can reuse a fileKey for different content.
		// A missing blob surfaces at solve time (compute_error → 500) rather than
		// an upfront 404, since it's no longer read eagerly here.
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

	// Everything above (auth, DB, blob/remote fetch) is the "load" phase; tree
	// build and solve are measured inside the pipeline.
	const defLoadMs = performance.now() - loadStart;

	// Atomic check-and-increment; runs before solve to avoid wasting compute.
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

	const serverConfig = await resolveServerForOrg(
		solveCtx,
		solveOrgId,
		locals.providers.data.computeServer,
		{ definitionPin }
	);
	mark('resolveServer');

	// BRIDGE: remove ~2026-09 — lazy backfill for versions uploaded before schema
	// caching existed. Best-effort. Removing it: delete this block, tighten
	// `DefinitionVersion.schema` to required in platform types + Zod, and drop the
	// live-fetch fallback in loadForRender.server.ts.
	if (localVersionForBackfill && !localVersionForBackfill.hasSchema && localDefinitionRef) {
		const versionId = localVersionForBackfill.id;
		try {
			// Warms the byte-cache entry the upcoming solve's `load()` would hit anyway.
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

	// `SolveEngine.solve` owns warm-client lookup, input-tree build,
	// single-flight coalescing, the abort/hasWaiters dance (a coalesced solve
	// must not follow one caller's disconnect and 499 every waiter), and
	// per-caller Accept-Encoding re-keying. Remote-URL solves have no version
	// id, so the URL stands in as coalesce-key identity (`definitionKey`);
	// local solves already carry that identity on `localDefinitionRef.key`.
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

	// Metric recording is app policy — the engine only maps outcome to HTTP.
	// These branches don't return; `engine.toWebResponse` below does.
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
		// Best-effort: the solve already succeeded, so a failed counter write
		// must not turn into a request error. Local definitions only — remote
		// URLs have no record to bump.
		if (metricDefinitionId) {
			providers.data.definitions.incrementSolveCount(solveCtx, metricDefinitionId).catch((err) =>
				locals.log.warn('solveCount increment failed', {
					component: 'API/Compute',
					definitionId: metricDefinitionId,
					err: renderThrown(err)
				})
			);
		}

		if (COMPUTE_DEBUG) logDebugBreakdown(locals, request, outcome, defLoadMs, prepMarks);
	}

	// Builds the Response itself (incl. `Retry-After` on a rejected `shed`,
	// which `apiError` cannot set) and still throws `compute_error` through to
	// the caller's outer catch.
	return engine.toWebResponse(outcome);
}

/**
 * Both solve routes share this so they cannot drift on which failures read as
 * "compute is down" (503) versus a server bug (500).
 */
export function mapSolveError(err: unknown, locals: App.Locals): never {
	if (isHttpError(err)) throw err;
	// A guard's own refusal, not a failed solve — converted rather than
	// re-thrown. These routes return their Response directly instead of going
	// through `mount`, so an `ApiError` escaping here would reach SvelteKit,
	// which gives anything that isn't an `HttpError` a 500, turning a working
	// permission check into an operator error page.
	if (isApiError(err)) {
		apiError(err.status, err.code, err.message);
	}

	if (err instanceof ComputeServerUnconfiguredError) {
		apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
	}

	const message = err instanceof Error ? err.message : 'Unknown error';
	locals.log.error('Solve request failed', {
		component: 'API/Compute',
		err: renderThrown(err),
		// The compute server's raw error body (bounded by the transport) — the
		// message alone can be scrubbed to a generic string in the server's
		// production mode, so this is often the only diagnostic that survives.
		...(err instanceof ComputeError &&
			typeof err.context?.responseBody === 'string' && {
				computeResponseBody: err.context.responseBody
			})
	});

	// The compute transport classifies its failures — map the classes the caller
	// can act on. Unreachable/credentials/saturation are operator problems (503),
	// a deadline is 504; only a genuine solve failure stays 500.
	if (err instanceof ComputeError) {
		if (err.code === ErrorCodes.NETWORK_ERROR || err.code === ErrorCodes.CORS_ERROR) {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server is unreachable');
		}
		if (err.code === ErrorCodes.AUTH_ERROR) {
			apiError(
				503,
				ApiErrorCode.COMPUTE_UNAVAILABLE,
				"Compute server rejected this deployment's credentials — check the compute API key configuration."
			);
		}
		if (err.code === ErrorCodes.RATE_LIMIT) {
			apiError(
				503,
				ApiErrorCode.COMPUTE_UNAVAILABLE,
				'Compute server is rate-limiting requests. Retry shortly.'
			);
		}
		if (err.code === ErrorCodes.TIMEOUT_ERROR) {
			apiError(
				504,
				ApiErrorCode.COMPUTE_UNAVAILABLE,
				'Compute server timed out running the solve.'
			);
		}
	}

	// A transport-layer fetch failure means the compute server is unreachable,
	// not an internal error. (Raw TypeError only from fetches outside the compute
	// transport — the transport wraps its own into ComputeError NETWORK_ERROR.)
	if (err instanceof TypeError && message === 'fetch failed') {
		apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, 'Compute server is unreachable');
	}

	apiError(500, ApiErrorCode.INTERNAL, message);
}

/**
 * DEBUG (SELVA_FLAG_COMPUTE_DEBUG): the server-side overhead the solve metric's
 * `durationMs` doesn't capture. `load` = auth + DB + definition fetch; `tree` =
 * input tree build; `serialize` = JSON.stringify of the result.
 */
function logDebugBreakdown(
	locals: App.Locals,
	request: Request,
	outcome: { envelope: SolveEnvelope },
	defLoadMs: number,
	prepMarks: [string, number][]
): void {
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
		// Accept-Encoding, making compression impossible end-to-end.
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
	// The only place evictions surface — per-request Server-Timing only carries
	// hit/miss verdicts.
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
