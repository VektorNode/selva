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
import { camelcaseKeys } from '@selvajs/compute/core';
import type { UISchema } from '@selvajs/schemas';
import type {
	ComputeServerConfig,
	DefinitionRecord,
	DefinitionVersion,
	RequestContext
} from '@selvajs/platform';
import { getStorageProvider, getDefinitionMeta, getProjectProvider } from '../providers.server';
import { resolveServerForOrg } from '../compute/resolve.server';

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

/**
 * Load a definition's version blob + schema (with merged compute defaults) for
 * the given channel. Throws `DefinitionLoadError` for classified failures so
 * the caller can translate to HTTP status codes.
 */
export async function loadDefinitionForRender(
	ctx: RequestContext,
	record: DefinitionRecord,
	channel: DefinitionChannel
): Promise<LoadedDefinition> {
	const storage = getStorageProvider();
	const meta = getDefinitionMeta();
	const projects = getProjectProvider();

	const versionId = channel === 'draft' ? record.draftVersionId : record.liveVersionId;
	if (!versionId)
		throw new DefinitionLoadError('data', `Definition '${record.guid}' has no ${channel} version`);

	const version = await meta.getVersion(ctx, versionId);
	if (!version)
		throw new DefinitionLoadError('data', `${channel} version missing for '${record.guid}'`);

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
		// Fetch schema and IO in parallel — both are fast (no solve needed).
		const [definition, fetchedSchema] = await Promise.all([
			client.getIO(definitionSource),
			fetchSchemaFromCompute(definitionSource, computeServer)
		]);

		if (!definition) {
			throw new Error(`Failed to get definition IO — server returned undefined`);
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

// Fetch UI schema from Rhino Compute's /grasshopper/schema endpoint (no solve required).
async function fetchSchemaFromCompute(
	definitionBytes: Uint8Array,
	server: ComputeServerConfig
): Promise<UISchema> {
	const schemaUrl = new URL('/grasshopper/schema', server.serverUrl).toString();

	const formData = new FormData();
	const blob = new Blob([new Uint8Array(definitionBytes)], { type: 'application/octet-stream' });
	formData.append('file', blob, 'definition.gh');

	const headers: Record<string, string> = {};
	if (server.apiKey) {
		headers['RhinoComputeKey'] = server.apiKey;
	}

	const response = await fetch(schemaUrl, { method: 'POST', headers, body: formData });

	if (!response.ok) {
		throw new Error(`Schema endpoint returned ${response.status}: ${response.statusText}`);
	}

	// Compute returns [{ FileName, Schemas }] with PascalCase wrapper keys only.
	// The schema contents are already camelCase from our C# serializer, so we only
	// need a shallow camelcase to normalize FileName→fileName, Schemas→schemas.
	// deep:true would mangle user-defined option names (e.g. "Display3d" → "display3d").
	const raw = await response.json();
	const results: { schemas: UISchema[] }[] = camelcaseKeys(Array.isArray(raw) ? raw : [raw]) as {
		schemas: UISchema[];
	}[];
	const schemas = results.flatMap((r) => r.schemas ?? []);

	if (schemas.length === 0) {
		throw new Error(
			'No schemas found in definition.\n\n' +
				'In Grasshopper, verify a Context Bake component with the output name "Schema" is present and wired to the solver.'
		);
	}

	return schemas[0];
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
