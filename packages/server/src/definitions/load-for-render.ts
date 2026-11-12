// Given a definition record, produces everything the client needs to render its
// form and solve it.
//
// Access gating is deliberately NOT done here — the calling route decides
// whether `ctx` may load this definition, since gates differ across routes
// (project membership, segment ownership, share-token, admin override).
//
// Everything stateful is injected, so any app on the engine can wire its own
// composition root.
//
// A render never waits on Compute when the version has a stored schema: it serves that and reads
// Compute behind it. Only a version with nothing renderable stored waits, and not past
// `renderWaitMs`. A large definition can keep Compute's `/io` busy for longer than a reverse
// proxy holds a request.

import type { GrasshopperClient, GrasshopperParsedIO } from '@selvajs/compute/grasshopper';
import { UI_SCHEMA_VERSION, type UISchema } from '@selvajs/schemas';
import type {
	ComputeServerConfig,
	DefinitionRecord,
	DefinitionVersion,
	IDefinitionStore,
	IProjectStore,
	IStorageProvider,
	RequestContext
} from '@selvajs/platform';
import { NoopLogger, type ILogger } from '@selvajs/platform';
import { compareSchemaVersion, fetchSchemaFromCompute } from './schema-extraction.js';
import { applySavedValues, savedValuesFrom, type SavedValues } from './saved-values.js';
import { withTimeout } from './with-timeout.js';

export type DefinitionChannel = 'live' | 'draft';

export interface LoadedDefinition {
	version: DefinitionVersion;
	definitionSource: Uint8Array;
	computeServer: ComputeServerConfig;
	schema: UISchema;
}

/**
 * Classified failure modes so callers can map to appropriate HTTP status:
 *   - 'data':           record references a version/blob that isn't there. (400)
 *   - 'missing-config': no compute server resolvable for this org/definition. (503)
 *   - 'connect':        compute server is unreachable, or too slow to answer. (503)
 *   - 'schema':         compute responded but IO/schema phase failed. (500)
 */
export type DefinitionLoadErrorKind = 'data' | 'missing-config' | 'connect' | 'schema';

export class DefinitionLoadError extends Error {
	constructor(
		public readonly kind: DefinitionLoadErrorKind,
		message: string,
		public readonly cause?: unknown
	) {
		super(message);
		this.name = 'DefinitionLoadError';
	}
}

export interface DefinitionLoaderDeps {
	storage: Pick<IStorageProvider, 'get'>;
	definitions: Pick<IDefinitionStore, 'getVersion' | 'setVersionSchema'>;
	projects: Pick<IProjectStore, 'getProject'>;
	/** Resolution order: definition pin → org default override → global default. */
	resolveServer: (
		ctx: RequestContext,
		orgId: string | null,
		opts: { definitionPin: string | null }
	) => Promise<ComputeServerConfig>;
	/** Shared warm-client cache, keyed by server id. */
	getClient: (server: ComputeServerConfig) => Promise<{ client: GrasshopperClient }>;
	/** Schema extraction; defaults to `fetchSchemaFromCompute`. Injectable for tests. */
	fetchSchema?: (bytes: Uint8Array, server: ComputeServerConfig) => Promise<UISchema>;
	/**
	 * Longest a load waits on Compute for a version with no renderable stored schema, before it
	 * fails as 'connect'. Keep it under the reverse proxy's timeout, or the proxy answers 504
	 * first. Default `DEFAULT_RENDER_WAIT_MS`.
	 */
	renderWaitMs?: number;
	/**
	 * When set, an unhealthy IO result also dumps the raw /io wire shape, making
	 * casing/serialization mismatches visible.
	 */
	computeDebug?: boolean;
	/** Legacy diagnostic sink. When set it takes the warnings below instead of `logger`. */
	onWarn?: (message: string, detail?: string) => void;
	/**
	 * Defaults to `NoopLogger`, so a consumer that wires nothing gets silence
	 * rather than unsolicited stdout.
	 */
	logger?: ILogger;
}

export interface DefinitionLoadOptions {
	/**
	 * For callers that read only schema STRUCTURE (input ids, `source.key`,
	 * widget types — anything persisted at upload). A fresh stored schema is then
	 * returned as stored, and Compute is not read for it, not even in the
	 * background: a page resolving several definitions would otherwise send each
	 * file to Compute.
	 */
	skipComputeDefaults?: boolean;
}

export type DefinitionLoader = (
	ctx: RequestContext,
	record: DefinitionRecord,
	channel: DefinitionChannel,
	explicitVersionId?: string | null,
	options?: DefinitionLoadOptions
) => Promise<LoadedDefinition>;

interface ComputeRead {
	ctx: RequestContext;
	record: DefinitionRecord;
	version: DefinitionVersion;
	source: Uint8Array;
	server: ComputeServerConfig;
}

/**
 * The returned loader resolves the `channel` pointer (live/draft) by default.
 * `explicitVersionId` renders an arbitrary historical version instead — the
 * caller MUST gate that behind edit permission, as with the draft channel.
 */
export function createDefinitionLoader(deps: DefinitionLoaderDeps): DefinitionLoader {
	const {
		storage,
		definitions,
		projects,
		resolveServer,
		getClient,
		fetchSchema = fetchSchemaFromCompute,
		renderWaitMs = DEFAULT_RENDER_WAIT_MS,
		computeDebug = false,
		onWarn,
		logger = new NoopLogger()
	} = deps;

	// Schemas extracted because the row had none usable, keyed by version id. The row write may
	// never land: a viewer or share-link context may not be able to write it (Supabase RLS turns
	// the UPDATE into a silent 0-row success), and then every load would call Compute. An older
	// format expires after `OLDER_SCHEMA_RECHECK_MS`.
	const extracts = new Map<string, { schema: UISchema; extractedAt: string }>();
	// Read once per version per process. The stored row may already hold them, but nothing on the
	// row says so, and a context that cannot write the row still needs them.
	const savedValues = new Map<string, SavedValues>();
	// One Compute read per version at a time; loads arriving meanwhile share it.
	const reads = new Map<string, Promise<UISchema>>();
	// When a version's last read failed, so a broken Compute isn't sent the file on every load.
	const failedAt = new Map<string, number>();

	function warn(message: string, title: string, fields: Record<string, unknown>) {
		if (onWarn) onWarn(message);
		else logger.warn(title, { component: 'loadForRender', ...fields });
	}

	function cachedSchemaFor(version: DefinitionVersion): UISchema | null {
		const row = version.schema as UISchema | undefined;
		if (row && isUsableCachedSchema(row, version.schemaExtractedAt)) return row;
		const memo = extracts.get(version.id);
		if (!memo) return null;
		if (isUsableCachedSchema(memo.schema, memo.extractedAt)) return memo.schema;
		extracts.delete(version.id);
		return null;
	}

	async function readFromCompute({
		ctx,
		record,
		version,
		source,
		server
	}: ComputeRead): Promise<UISchema> {
		let client: GrasshopperClient;
		try {
			client = (await getClient(server)).client;
		} catch (err) {
			throw new DefinitionLoadError(
				'connect',
				`Failed to connect to Rhino Compute server: ${messageOf(err)}`,
				err
			);
		}

		try {
			// The stored schema is a disposable cache (`isUsableCachedSchema`). Past it
			// (or on a pre-caching row with no schema) re-extract from compute, whose C#
			// SchemaMigrator emits its plugin's format — the web side never migrates
			// schemas itself.
			const fresh = cachedSchemaFor(version);
			const [io, extracted] = await Promise.all([
				client.getIO(source),
				fresh ? Promise.resolve(fresh) : fetchSchema(source, server)
			]);
			if (!io) throw new Error(`Failed to get definition IO — server returned undefined`);
			assertHasInputs(extracted);
			await reportUnhealthyIO(record, io, () => client.getRawIO(source));

			const values = savedValuesFrom(io.inputs);
			setBounded(savedValues, version.id, values);
			const schema = applySavedValues(extracted, values);

			// An older format (compute plugin behind the app) is warned about once per window, so
			// it costs one Compute call per instance per window.
			const extractedAt = new Date().toISOString();
			if (!fresh) setBounded(extracts, version.id, { schema: extracted, extractedAt });
			if (!fresh && compareSchemaVersion(extracted.schemaVersion) === -1) {
				warn(
					`[loadForRender] compute's plugin emits schema format ${extracted.schemaVersion ?? '(none)'} ` +
						`for version ${version.id}, behind this app's ${UI_SCHEMA_VERSION}; serving it for ` +
						`${OLDER_SCHEMA_RECHECK_MS / 3_600_000} h before asking again. Update the plugin.`,
					'Compute plugin behind the app schema format',
					{ versionId: version.id, emitted: extracted.schemaVersion, expected: UI_SCHEMA_VERSION }
				);
			}

			const row = version.schema as UISchema | undefined;
			const rowCurrent = fresh !== null && row !== undefined && sameDefaults(row, schema);
			if (!rowCurrent && isUsableCachedSchema(schema, extractedAt))
				persist(ctx, version.id, schema);
			return schema;
		} catch (err) {
			if (err instanceof DefinitionLoadError) throw err;
			throw new DefinitionLoadError('schema', messageOf(err), err);
		}
	}

	// Best-effort — a viewer context may lack write access, and the next editor render or the
	// solve-time backfill will land it. Stores exactly what a read right after the write would
	// serve, so the two rules cannot drift.
	function persist(ctx: RequestContext, versionId: string, schema: UISchema) {
		definitions.setVersionSchema(ctx, versionId, schema).catch((err) => {
			warn(
				`[loadForRender] schema cache refresh failed for version ${versionId}: ${messageOf(err)}`,
				'Schema cache refresh failed',
				{ versionId, err: err instanceof Error ? (err.stack ?? err.message) : String(err) }
			);
		});
	}

	// Zero inputs or reported parse/load problems mean a definition that will
	// render wrong without saying why: an empty ValueList whose backing GH
	// component didn't resolve ("Missing Definition Objects"), or a PascalCase
	// /io response the parser silently dropped to []. Warning is always on —
	// it only fires on the unhappy path — while the raw wire dump costs an
	// extra round-trip and stays behind `computeDebug`.
	async function reportUnhealthyIO(
		record: DefinitionRecord,
		io: GrasshopperParsedIO,
		readRawIO: () => Promise<unknown>
	) {
		const parseErrors = (io as { parseErrors?: unknown[] }).parseErrors ?? [];
		const loadErrors = (io as { loadErrors?: unknown[] }).loadErrors ?? [];
		if (io.inputs.length > 0 && parseErrors.length === 0 && loadErrors.length === 0) return;

		const health = {
			inputCount: io.inputs.length,
			outputCount: io.outputs?.length,
			parseErrors,
			loadErrors,
			loadWarnings: (io as { loadWarnings?: unknown }).loadWarnings
		};
		if (onWarn) onWarn(`[loadForRender] IO health for '${record.guid}':`, JSON.stringify(health));
		else
			logger.warn('Definition IO looks unhealthy', {
				component: 'loadForRender',
				definitionGuid: record.guid,
				...health
			});

		if (!computeDebug) return;
		const rawIO = await readRawIO().catch((e) => ({ error: String(e) }));
		const rendered = JSON.stringify(rawIO).slice(0, 3000);
		if (onWarn) onWarn('[loadForRender] raw /io:', rendered);
		else
			logger.debug('Raw /io wire shape', {
				component: 'loadForRender',
				definitionGuid: record.guid,
				rawIO: rendered
			});
	}

	function read(job: ComputeRead): Promise<UISchema> {
		const id = job.version.id;
		const running = reads.get(id);
		if (running) return running;

		const pending = withTimeout(
			readFromCompute(job),
			COMPUTE_READ_TIMEOUT_MS,
			() =>
				new DefinitionLoadError(
					'connect',
					`Rhino.Compute did not finish reading this definition within ${COMPUTE_READ_TIMEOUT_MS / 1000} s`
				)
		)
			.then(
				(schema) => {
					failedAt.delete(id);
					return schema;
				},
				(err) => {
					setBounded(failedAt, id, Date.now());
					throw err;
				}
			)
			.finally(() => reads.delete(id));
		reads.set(id, pending);
		return pending;
	}

	function readInBackground(job: ComputeRead) {
		const id = job.version.id;
		if (reads.has(id)) return;
		const failed = failedAt.get(id);
		if (failed !== undefined && Date.now() - failed < READ_RETRY_MS) return;

		read(job).catch((err) => {
			warn(
				`[loadForRender] background read failed for version ${id}: ${messageOf(err)}`,
				'Background definition read failed',
				{ versionId: id, definitionGuid: job.record.guid, err: messageOf(err) }
			);
		});
	}

	return async function loadDefinitionForRender(ctx, record, channel, explicitVersionId, options) {
		const versionId =
			explicitVersionId ?? (channel === 'draft' ? record.draftVersionId : record.liveVersionId);
		if (!versionId)
			throw new DefinitionLoadError(
				'data',
				`Definition '${record.guid}' has no ${channel} version`
			);

		// The server needs only the record, so it resolves while the version and file are read.
		// It is awaited after them, so a definition missing its data still fails as 'data'.
		const pendingServer = (async (): Promise<ComputeServerConfig> => {
			const project = await projects.getProject(ctx, record.projectId);
			try {
				return await resolveServer(ctx, project?.orgId ?? null, {
					definitionPin: record.computeServerId ?? null
				});
			} catch (err) {
				throw new DefinitionLoadError(
					'missing-config',
					'No compute server configured for this definition',
					err
				);
			}
		})();
		pendingServer.catch(() => {});

		const version = await definitions.getVersion(ctx, versionId);
		if (!version) throw new DefinitionLoadError('data', `version missing for '${record.guid}'`);
		// An explicitly requested version must belong to this definition.
		if (version.definitionId !== record.guid)
			throw new DefinitionLoadError('data', `version does not belong to '${record.guid}'`);

		const definitionSource = await storage.get(version.fileKey);
		if (!definitionSource)
			throw new DefinitionLoadError(
				'data',
				`Definition file for '${record.guid}' not found on disk`
			);

		const computeServer = await pendingServer;
		const loaded = { version, definitionSource, computeServer };
		const job: ComputeRead = {
			ctx,
			record,
			version,
			source: definitionSource,
			server: computeServer
		};

		const fresh = cachedSchemaFor(version);
		if (options?.skipComputeDefaults && fresh) return { ...loaded, schema: fresh };

		const values = savedValues.get(version.id);
		if (fresh && values) return { ...loaded, schema: applySavedValues(fresh, values) };

		// An older format past its recheck window still renders: serve it while Compute is asked.
		const stored = fresh ?? servableStaleSchema(version);
		if (stored) {
			readInBackground(job);
			return { ...loaded, schema: values ? applySavedValues(stored, values) : stored };
		}

		// The read carries on past the wait, so a retry finds it done.
		const schema = await withTimeout(
			read(job),
			renderWaitMs,
			() =>
				new DefinitionLoadError(
					'connect',
					'Rhino.Compute is still reading this definition. Retry in a moment.'
				)
		);
		return { ...loaded, schema };
	};
}

/**
 * How long a schema in an OLDER format serves from the cache before Compute is asked again. A
 * plugin behind the app re-emits that same format, so asking on every load only buys a Compute
 * round trip (10 s+ while a child starts); the window bounds how long a plugin upgrade waits.
 */
export const OLDER_SCHEMA_RECHECK_MS = 24 * 60 * 60 * 1000;

/** Under nginx's default 60 s and the 30 s many load balancers use. */
export const DEFAULT_RENDER_WAIT_MS = 20_000;

// Frees the per-version read slot when Compute hangs; the load waiting on it gave up long before.
const COMPUTE_READ_TIMEOUT_MS = 120_000;

// After a failed read, background reads of that version pause this long.
const READ_RETRY_MS = 60_000;

// Bounds each in-process memo; the oldest entry is evicted first.
const MEMO_MAX = 1000;

function setBounded<V>(map: Map<string, V>, key: string, value: V) {
	if (map.size >= MEMO_MAX && !map.has(key)) map.delete(map.keys().next().value!);
	map.set(key, value);
}

/**
 * A cached schema is usable when it is structurally sound and either the current format version,
 * or an older one (missing counts, see `compareSchemaVersion`) extracted within
 * `OLDER_SCHEMA_RECHECK_MS` of `now`, either side: a future stamp from a skewed clock still
 * expires. Without `extractedAt` only the current version passes. The `inputs` check is the
 * PascalCase guard: a compute server that serialized with the wrong Newtonsoft emits `Inputs`, and
 * such a row must never be served. See `assertCamelCaseSchema`.
 */
export function isUsableCachedSchema(
	schema: UISchema,
	extractedAt?: string,
	now: number = Date.now()
): boolean {
	if (!Array.isArray(schema.inputs)) return false;
	const order = compareSchemaVersion(schema.schemaVersion);
	if (order === 0) return true;
	if (order !== -1 || !extractedAt) return false;
	const at = Date.parse(extractedAt);
	return Number.isFinite(at) && Math.abs(now - at) < OLDER_SCHEMA_RECHECK_MS;
}

/** A stored older-format schema past its recheck window. Newer and PascalCase rows never render. */
function servableStaleSchema(version: DefinitionVersion): UISchema | null {
	const row = version.schema as UISchema | undefined;
	if (!row || !Array.isArray(row.inputs)) return null;
	return compareSchemaVersion(row.schemaVersion) === -1 ? row : null;
}

function assertHasInputs(schema: UISchema) {
	if (Array.isArray(schema.inputs)) return;
	throw new DefinitionLoadError(
		'schema',
		`Schema has no 'inputs' array (keys: ${Object.keys(schema as object)
			.slice(0, 12)
			.join(', ')}). A PascalCase shape here means compute serialized it with the wrong ` +
			`Newtonsoft — see assertCamelCaseSchema.`
	);
}

function sameDefaults(a: UISchema, b: UISchema): boolean {
	const defaults = (schema: UISchema) =>
		JSON.stringify(schema.inputs.map((input) => input.default));
	return Array.isArray(a.inputs) && defaults(a) === defaults(b);
}

function messageOf(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
