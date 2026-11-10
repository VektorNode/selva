// Given a definition record, produces everything the client needs to render its
// form and solve it.
//
// Access gating is deliberately NOT done here — the calling route decides
// whether `ctx` may load this definition, since gates differ across routes
// (project membership, segment ownership, share-token, admin override).
//
// Everything stateful is injected, so any app on the engine can wire its own
// composition root.

import type { GrasshopperClient } from '@selvajs/compute/grasshopper';
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
 *   - 'connect':        compute server is configured but unreachable. (503)
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
	 * widget types — anything persisted at upload). A fresh cached schema then
	 * returns without touching compute, whose multi-second connect otherwise
	 * dominates a page resolving several definitions.
	 *
	 * Leave unset (the default) for anything that RENDERS a form — without
	 * compute defaults the form shows the wrong initial values.
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
		computeDebug = false,
		onWarn,
		logger = new NoopLogger()
	} = deps;

	// Older-format extracts, keyed by version id. The window must not hang on the row's
	// `schemaExtractedAt`: a viewer or share-link context may not be able to write it (Supabase
	// RLS turns the UPDATE into a silent 0-row success), and then every load would call Compute.
	const olderExtracts = new Map<string, { schema: UISchema; extractedAt: string }>();

	function cachedSchemaFor(version: DefinitionVersion): UISchema | null {
		const row = version.schema as UISchema | undefined;
		if (row && isUsableCachedSchema(row, version.schemaExtractedAt)) return row;
		const memo = olderExtracts.get(version.id);
		if (!memo) return null;
		if (isUsableCachedSchema(memo.schema, memo.extractedAt)) return memo.schema;
		olderExtracts.delete(version.id);
		return null;
	}

	function rememberOlderExtract(versionId: string, schema: UISchema, extractedAt: string) {
		if (olderExtracts.size >= OLDER_EXTRACTS_MAX && !olderExtracts.has(versionId)) {
			olderExtracts.delete(olderExtracts.keys().next().value!);
		}
		olderExtracts.set(versionId, { schema, extractedAt });
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

		// Returning before `getClient` is the point — the connect is the cost, not
		// the `getIO` it carries. The cache may hold an older format inside the recheck
		// window, exactly as the full path would serve; an unusable one falls through.
		if (options?.skipComputeDefaults) {
			const cachedSchema = cachedSchemaFor(version);
			if (cachedSchema) return { version, definitionSource, computeServer, schema: cachedSchema };
		}

		// Only the client is used here (getIO); the entry's solve scheduler rides
		// along unused.
		let client: GrasshopperClient;
		try {
			client = (await getClient(computeServer)).client;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new DefinitionLoadError(
				'connect',
				`Failed to connect to Rhino Compute server: ${message}`,
				err
			);
		}

		try {
			// The stored schema is a disposable cache (`isUsableCachedSchema`). Past it
			// (or on a pre-caching row with no schema) re-extract from compute, whose C#
			// SchemaMigrator emits its plugin's format — the web side never migrates
			// schemas itself. `getIO` runs either way, to merge compute default values in.
			const freshCache = cachedSchemaFor(version);
			const [definition, fetchedSchema] = await Promise.all([
				client.getIO(definitionSource),
				freshCache ? Promise.resolve(freshCache) : fetchSchema(definitionSource, computeServer)
			]);

			// An older format (compute plugin behind the app) is remembered in-process and
			// warned about once per window, so it costs one Compute call per instance per window.
			const extractedAt = new Date().toISOString();
			if (!freshCache && compareSchemaVersion(fetchedSchema.schemaVersion) === -1) {
				rememberOlderExtract(version.id, fetchedSchema, extractedAt);
				const message =
					`[loadForRender] compute's plugin emits schema format ${fetchedSchema.schemaVersion ?? '(none)'} ` +
					`for version ${version.id}, behind this app's ${UI_SCHEMA_VERSION}; serving it for ` +
					`${OLDER_SCHEMA_RECHECK_MS / 3_600_000} h before asking again. Update the plugin.`;
				if (onWarn) onWarn(message);
				else
					logger.warn('Compute plugin behind the app schema format', {
						component: 'loadForRender',
						versionId: version.id,
						emitted: fetchedSchema.schemaVersion,
						expected: UI_SCHEMA_VERSION
					});
			}

			// Best-effort — a viewer context may lack write access, and the next editor
			// render or the solve-time backfill will land it. Stores exactly what a read
			// right after the write would serve, so the two rules cannot drift.
			if (!freshCache && isUsableCachedSchema(fetchedSchema, extractedAt)) {
				definitions.setVersionSchema(ctx, version.id, fetchedSchema).catch((err) => {
					if (onWarn) {
						onWarn(
							`[loadForRender] schema cache refresh failed for version ${version.id}: ` +
								`${err instanceof Error ? err.message : String(err)}`
						);
						return;
					}
					logger.warn('Schema cache refresh failed', {
						component: 'loadForRender',
						versionId: version.id,
						err: err instanceof Error ? (err.stack ?? err.message) : String(err)
					});
				});
			}

			if (!definition) {
				throw new Error(`Failed to get definition IO — server returned undefined`);
			}

			// Zero inputs or reported parse/load problems mean a definition that will
			// render wrong without saying why: an empty ValueList whose backing GH
			// component didn't resolve ("Missing Definition Objects"), or a PascalCase
			// /io response the parser silently dropped to []. Warning is always on —
			// it only fires on the unhappy path — while the raw wire dump costs an
			// extra round-trip and stays behind `computeDebug`.
			const ioParseErrors = (definition as { parseErrors?: unknown[] }).parseErrors ?? [];
			const ioLoadErrors = (definition as { loadErrors?: unknown[] }).loadErrors ?? [];
			const ioLooksBroken =
				definition.inputs.length === 0 || ioParseErrors.length > 0 || ioLoadErrors.length > 0;
			if (ioLooksBroken) {
				const health = {
					inputCount: definition.inputs.length,
					outputCount: definition.outputs?.length,
					parseErrors: ioParseErrors,
					loadErrors: ioLoadErrors,
					loadWarnings: (definition as { loadWarnings?: unknown }).loadWarnings
				};
				if (onWarn) {
					onWarn(`[loadForRender] IO health for '${record.guid}':`, JSON.stringify(health));
				} else {
					logger.warn('Definition IO looks unhealthy', {
						component: 'loadForRender',
						definitionGuid: record.guid,
						...health
					});
				}
				if (computeDebug) {
					const rawIO = await client
						.getRawIO(definitionSource)
						.catch((e) => ({ error: String(e) }));
					const rendered = JSON.stringify(rawIO).slice(0, 3000);
					if (onWarn) onWarn('[loadForRender] raw /io:', rendered);
					else
						logger.debug('Raw /io wire shape', {
							component: 'loadForRender',
							definitionGuid: record.guid,
							rawIO: rendered
						});
				}
			}

			return {
				version,
				definitionSource,
				computeServer,
				schema: mergeComputeDefaults(fetchedSchema, definition.inputs)
			};
		} catch (err) {
			if (err instanceof DefinitionLoadError) throw err;
			const message = err instanceof Error ? err.message : String(err);
			throw new DefinitionLoadError('schema', message, err);
		}
	};
}

/**
 * How long a schema in an OLDER format serves from the cache before Compute is asked again. A
 * plugin behind the app re-emits that same format, so asking on every load only buys a Compute
 * round trip (10 s+ while a child starts); the window bounds how long a plugin upgrade waits.
 */
export const OLDER_SCHEMA_RECHECK_MS = 24 * 60 * 60 * 1000;

// Bounds the in-process older-extract memo; the oldest entry is evicted first.
const OLDER_EXTRACTS_MAX = 1000;

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

// Colors come back from Compute as "r,g,b" or "a,r,g,b" strings — converted to
// hex here so the color picker can consume them directly.
function mergeComputeDefaults(
	schema: UISchema,
	computeInputs: Array<{ id?: string; paramType?: string; default?: unknown }>
): UISchema {
	if (!Array.isArray(schema.inputs)) {
		throw new DefinitionLoadError(
			'schema',
			`Schema has no 'inputs' array (keys: ${Object.keys(schema as object)
				.slice(0, 12)
				.join(', ')}). A PascalCase shape here means compute serialized it with the wrong ` +
				`Newtonsoft — see assertCamelCaseSchema.`
		);
	}

	const byParamId = new Map(computeInputs.map((input) => [input.id, input]));

	return {
		...schema,
		inputs: schema.inputs.map((schemaInput) => {
			const computeInput = byParamId.get(schemaInput.id);

			if (computeInput?.paramType === 'Color' && computeInput.default !== undefined) {
				const toHex = (value: number) => value.toString(16).padStart(2, '0');
				const parts = String(computeInput.default)
					.split(',')
					.map((s) => parseInt(s.trim(), 10));

				if (parts.length === 3) {
					computeInput.default = `#${toHex(parts[0])}${toHex(parts[1])}${toHex(parts[2])}`;
				} else if (parts.length === 4) {
					computeInput.default = `#${toHex(parts[1])}${toHex(parts[2])}${toHex(parts[3])}`;
				}
			}

			if (computeInput && computeInput.default !== undefined) {
				return { ...schemaInput, default: computeInput.default };
			}
			return schemaInput;
		})
	};
}
