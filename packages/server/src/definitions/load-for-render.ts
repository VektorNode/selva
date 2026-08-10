// Loader for "given a definition record, produce everything the client needs to
// render its form and solve it": version resolution, blob fetch, compute-server
// resolution, schema fetch (with the ADR 0005 staleness check), default merging.
//
// Access gating is intentionally NOT done here — the calling route decides
// whether `ctx` is allowed to load this definition, since gates differ across
// routes (project membership, segment ownership, share-token, admin override).
//
// Everything stateful is injected (`DefinitionLoaderDeps`): stores, server
// resolution, the warm-client cache, and the schema fetcher — so any app built
// on the engine can wire its own composition root.

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
import { fetchSchemaFromCompute } from './schema-extraction.js';

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
	/** §3 resolution order: definition pin → org default override → global default. */
	resolveServer: (
		ctx: RequestContext,
		orgId: string | null,
		opts: { definitionPin: string | null }
	) => Promise<ComputeServerConfig>;
	/** Shared warm-client cache (ADR 0004: keyed by server id, definition-guid affinity header). */
	getClient: (
		server: ComputeServerConfig,
		opts: { definitionGuid: string }
	) => Promise<{ client: GrasshopperClient }>;
	/** Schema extraction; defaults to `fetchSchemaFromCompute`. Injectable for tests. */
	fetchSchema?: (bytes: Uint8Array, server: ComputeServerConfig) => Promise<UISchema>;
	/**
	 * Verbose IO diagnostics — when set, an unhealthy IO result (empty inputs /
	 * parse / load errors) also dumps the raw /io wire shape so
	 * casing/serialization mismatches are visible.
	 */
	computeDebug?: boolean;
	/**
	 * Legacy diagnostic sink, kept for callers that already pass one. When set it
	 * receives the rendered strings and `logger` is not used for these warnings.
	 */
	onWarn?: (message: string, detail?: string) => void;
	/**
	 * Structured logger for the diagnostics below. Defaults to `NoopLogger`, so a
	 * consumer that wires nothing gets silence rather than unsolicited stdout.
	 */
	logger?: ILogger;
}

export interface DefinitionLoadOptions {
	/**
	 * Skip the `getIO` round-trip that merges compute default *values* into the
	 * schema, when the cached schema on the version row is usable.
	 *
	 * A caller that reads only schema STRUCTURE (input ids, `source.key`, widget
	 * types — anything persisted at upload) does not need defaults, and paying a
	 * multi-second compute connect per definition to fetch them dominates a page
	 * that resolves several. With this set, a fresh cached schema returns without
	 * touching compute at all; a missing or stale-format cache still falls back to
	 * the full path, so the result is always a valid schema.
	 *
	 * Leave unset (the default) for anything that RENDERS a form — a form without
	 * compute defaults shows the wrong initial values.
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
 * Build a definition loader over the injected stores/compute wiring.
 *
 * The returned function loads a definition's version blob + schema (with
 * merged compute defaults). By default it resolves the `channel` pointer
 * (live/draft); pass `explicitVersionId` to render an arbitrary historical
 * version instead — the caller must gate that behind edit permission
 * (editor-only, like the draft channel). Throws `DefinitionLoadError` for
 * classified failures so the caller can translate to HTTP status codes.
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

	return async function loadDefinitionForRender(ctx, record, channel, explicitVersionId, options) {
		const versionId =
			explicitVersionId ?? (channel === 'draft' ? record.draftVersionId : record.liveVersionId);
		if (!versionId)
			throw new DefinitionLoadError(
				'data',
				`Definition '${record.guid}' has no ${channel} version`
			);

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

		const project = await projects.getProject(ctx, record.projectId);
		let computeServer: ComputeServerConfig;
		try {
			computeServer = await resolveServer(ctx, project?.orgId ?? null, {
				definitionPin: record.computeServerId ?? null
			});
		} catch (err) {
			throw new DefinitionLoadError(
				'missing-config',
				'No compute server configured for this definition',
				err
			);
		}

		// Structure-only callers stop here: a fresh cached schema is everything they
		// need, and returning before `getClient` is the point — the connect is the
		// multi-second cost, not the `getIO` call it carries. A missing or
		// stale-format cache falls through to the full path below.
		if (options?.skipComputeDefaults) {
			const cachedSchema = version.schema as UISchema | undefined;
			if (cachedSchema && cachedSchema.schemaVersion === UI_SCHEMA_VERSION) {
				return { version, definitionSource, computeServer, schema: cachedSchema };
			}
		}

		// Only the client is used here (getIO); the entry's solve scheduler rides
		// along unused.
		let client: GrasshopperClient;
		try {
			client = (await getClient(computeServer, { definitionGuid: record.guid })).client;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			throw new DefinitionLoadError(
				'connect',
				`Failed to connect to Rhino Compute server: ${message}`,
				err
			);
		}

		try {
			// Prefer the schema cached on the version row (extracted + validated at
			// upload) — but ONLY when its format version matches the app's. The
			// stored schema is a disposable cache (ADR 0005): on a version mismatch
			// (or a pre-caching row with no schema at all) re-extract from compute,
			// whose C# SchemaMigrator emits the current format — the web side never
			// migrates schemas itself. `getIO` is always needed to merge compute
			// default values into the schema, cached or not.
			const cachedSchema = version.schema as UISchema | undefined;
			const freshCache =
				cachedSchema && cachedSchema.schemaVersion === UI_SCHEMA_VERSION ? cachedSchema : null;
			const [definition, fetchedSchema] = await Promise.all([
				client.getIO(definitionSource),
				freshCache ? Promise.resolve(freshCache) : fetchSchema(definitionSource, computeServer)
			]);

			// Persist the refreshed schema back onto the version row (best-effort —
			// a viewer context may lack write access; the next editor render or the
			// solve-time backfill will land it). Only when the re-extracted schema
			// is at the app's current version: persisting an older format (compute
			// plugin behind the app) would just go stale again next render.
			if (!freshCache && fetchedSchema.schemaVersion === UI_SCHEMA_VERSION) {
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

			// Surface IO health when something looks off: zero inputs, or the compute
			// layer reported parse/load problems (e.g. an empty ValueList because its
			// backing GH component didn't resolve → "Missing Definition Objects", or a
			// PascalCase /io response the parser silently dropped to []). On a problem
			// we also fetch the raw IO so the un-parsed wire shape is in the logs.
			// Always-on warn (cheap, only fires on the unhappy path); the verbose raw
			// dump is gated on `computeDebug`.
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

// Merge default values from Compute definition into schema inputs.
// Colors come back as "r,g,b" or "a,r,g,b" strings — convert to hex so the
// color picker can consume them directly.
function mergeComputeDefaults(
	schema: UISchema,
	computeInputs: Array<{ id?: string; paramType?: string; default?: unknown }>
): UISchema {
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
