// Loader for "given a definition record, produce everything the client needs to
// render its form and solve it." Extracted from /library/[guid]/+page.server.ts
// so any route that wants to render a definition (library by guid, future
// host-app routes resolved by domain entity, etc.) can share the heavy lifting:
// version resolution, blob fetch, compute-server resolution, schema fetch,
// default merging.
//
// Access gating is intentionally NOT done here — the calling route decides
// whether `ctx` is allowed to load this definition, since gates differ across
// routes (project membership, segment ownership, share-token, admin override).

import { GrasshopperClient } from '@selvajs/compute/grasshopper';
import type { UISchema } from '@selvajs/schemas';
import { fetchSchemaFromCompute } from './schemaExtraction.server';
import type {
	ComputeServerConfig,
	DefinitionRecord,
	DefinitionVersion,
	RequestContext
} from '@selvajs/platform';
import { getStorageProvider, getDefinitionMeta, getProjectProvider } from '../providers.server';
import { resolveServerForOrg } from '../compute/resolve.server';
import { env } from '$env/dynamic/private';

export type DefinitionChannel = 'live' | 'draft';

// Verbose IO diagnostics — same flag as the solve route. When set, an
// unhealthy IO result (empty inputs / parse / load errors) also dumps the raw
// /io wire shape so casing/serialization mismatches are visible.
const COMPUTE_DEBUG = ['true', '1', 'yes'].includes(
	(env.SELVA_FLAG_COMPUTE_DEBUG ?? '').toLowerCase()
);

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

/**
 * Load a definition's version blob + schema (with merged compute defaults).
 * By default resolves the `channel` pointer (live/draft); pass
 * `explicitVersionId` to render an arbitrary historical version instead — the
 * caller must gate that behind edit permission (editor-only, like the draft
 * channel). Throws `DefinitionLoadError` for classified failures so the caller
 * can translate to HTTP status codes.
 */
export async function loadDefinitionForRender(
	ctx: RequestContext,
	record: DefinitionRecord,
	channel: DefinitionChannel,
	explicitVersionId?: string | null
): Promise<LoadedDefinition> {
	const storage = getStorageProvider();
	const meta = getDefinitionMeta();
	const projects = getProjectProvider();

	const versionId =
		explicitVersionId ?? (channel === 'draft' ? record.draftVersionId : record.liveVersionId);
	if (!versionId)
		throw new DefinitionLoadError('data', `Definition '${record.guid}' has no ${channel} version`);

	const version = await meta.getVersion(ctx, versionId);
	if (!version) throw new DefinitionLoadError('data', `version missing for '${record.guid}'`);
	// An explicitly requested version must belong to this definition.
	if (version.definitionId !== record.guid)
		throw new DefinitionLoadError('data', `version does not belong to '${record.guid}'`);

	const definitionSource = await storage.get(version.fileKey);
	if (!definitionSource)
		throw new DefinitionLoadError('data', `Definition file for '${record.guid}' not found on disk`);

	// §3 — resolution order: definition pin → org default override → global default.
	const project = await projects.getProject(ctx, record.projectId);
	let computeServer: ComputeServerConfig;
	try {
		computeServer = await resolveServerForOrg(ctx, project?.orgId ?? null, {
			definitionPin: record.computeServerId ?? null
		});
	} catch (err) {
		throw new DefinitionLoadError(
			'missing-config',
			'No compute server configured for this definition',
			err
		);
	}

	let client: GrasshopperClient;
	try {
		client = await GrasshopperClient.create({
			serverUrl: computeServer.serverUrl,
			apiKey: computeServer.apiKey
		});
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
		// upload). Fall back to a live fetch for versions predating schema caching
		// — the solve-time backfill bridge fills those in over time
		// (see specs/SchemaCaching.md). `getIO` is always needed to merge compute
		// default values into the schema, cached or not.
		const [definition, fetchedSchema] = await Promise.all([
			client.getIO(definitionSource),
			version.schema
				? Promise.resolve(version.schema)
				: fetchSchemaFromCompute(definitionSource, computeServer)
		]);

		if (!definition) {
			throw new Error(`Failed to get definition IO — server returned undefined`);
		}

		// Surface IO health when something looks off: zero inputs, or the compute
		// layer reported parse/load problems (e.g. an empty ValueList because its
		// backing GH component didn't resolve → "Missing Definition Objects", or a
		// PascalCase /io response the parser silently dropped to []). On a problem
		// we also fetch the raw IO so the un-parsed wire shape is in the logs.
		// Always-on warn (cheap, only fires on the unhappy path); the verbose raw
		// dump is gated on SELVA_FLAG_COMPUTE_DEBUG.
		const ioParseErrors = (definition as { parseErrors?: unknown[] }).parseErrors ?? [];
		const ioLoadErrors = (definition as { loadErrors?: unknown[] }).loadErrors ?? [];
		const ioLooksBroken =
			definition.inputs.length === 0 || ioParseErrors.length > 0 || ioLoadErrors.length > 0;
		if (ioLooksBroken) {
			console.warn(
				`[loadForRender] IO health for '${record.guid}':`,
				JSON.stringify({
					inputCount: definition.inputs.length,
					outputCount: definition.outputs?.length,
					parseErrors: ioParseErrors,
					loadErrors: ioLoadErrors,
					loadWarnings: (definition as { loadWarnings?: unknown }).loadWarnings
				})
			);
			if (COMPUTE_DEBUG) {
				const rawIO = await client.getRawIO(definitionSource).catch((e) => ({ error: String(e) }));
				console.warn('[loadForRender] raw /io:', JSON.stringify(rawIO).slice(0, 3000));
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
