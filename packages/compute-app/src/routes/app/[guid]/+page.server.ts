import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GrasshopperClient } from '@selvajs/compute/grasshopper';
import { camelcaseKeys } from '@selvajs/compute/core';
import type { UISchema } from '@selvajs/shared';
import type { ComputeServerConfig, RequestContext } from '@selvajs/platform';
import {
	getStorageProvider,
	getDefinitionMeta,
	getProjectProvider
} from '$lib/server/providers.server';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { requireCanSolve } from '$lib/server/access.server';
import { tryResolveShareToken } from '$lib/server/shareLinks/resolve.server';
import { MAX_SOLVE_DURATION_MS } from '$lib/server/computeLimits';

/**
 * Fetch UI schema from Rhino Compute's /grasshopper/schema endpoint (no solve required).
 */
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

export const load = (async ({ params, locals, request, url }) => {
	const storage = getStorageProvider();
	const meta = getDefinitionMeta();
	const projects = getProjectProvider();

	const guid = params.guid;

	let definitionSource: Uint8Array;
	let server: ComputeServerConfig;
	const clientDefUrl = `local:${guid}`;
	// `shareToken` is forwarded to the page so the client can include it on
	// subsequent /api/compute/solve calls. null = user-authenticated session.
	let shareToken: string | null = null;

	try {
		// Spec §7 — try a share-link token first. App loader always serves the
		// `live` channel (preview-of-published embed). Schema fetch is view-only,
		// so we don't require `allowSolve` here; the solve route enforces that.
		const sharedAccess = await tryResolveShareToken(request, url, guid, 'live', {
			requireSolve: false
		});
		if (sharedAccess) {
			shareToken = url.searchParams.get('token');
		} else if (!locals.ctx || !locals.user) {
			throw error(401, 'Unauthorized: You must be logged in to access definitions');
		}

		const ctx: RequestContext = sharedAccess?.ctx ?? locals.ctx!;

		const record = await meta.get(ctx, guid);
		if (!record) throw new Error(`Definition '${guid}' not found`);

		// User-auth path needs the canSolve gate; token-auth was already gated.
		if (!sharedAccess) await requireCanSolve(locals, record.projectId);

		// §6 — the schema page always reflects the live channel.
		if (!record.liveVersionId) throw new Error(`Definition '${guid}' has no live version`);
		const version = await meta.getVersion(ctx, record.liveVersionId);
		if (!version) throw new Error(`Live version missing for '${guid}'`);
		const bytes = await storage.get(version.fileKey);
		if (!bytes) throw new Error(`Definition file for '${guid}' not found on disk`);

		definitionSource = bytes;

		// §3 — route the schema fetch through the owning org's compute when BYO
		// compute is configured; otherwise fall through to the instance pool.
		const project = await projects.getProject(ctx, record.projectId);
		try {
			server = await resolveServerForOrg(ctx, project?.orgId ?? null);
		} catch {
			throw error(503, 'No compute server configured. Ask an admin to add one in /admin/compute.');
		}
	} catch (err) {
		// Only wrap actual errors; let HttpError (from error() calls) bubble up
		if (err instanceof Error && !('status' in err)) {
			console.warn(`[App Load] Failed to load definition '${guid}':`, err);
			throw error(400, `Failed to load definition '${guid}': ${err.message}`);
		}
		throw err;
	}

	let client: GrasshopperClient;

	try {
		client = await GrasshopperClient.create({
			serverUrl: server.serverUrl,
			apiKey: server.apiKey
		});
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error('[PageLoad] Compute server connection failed:', errorMessage);
		throw error(503, `Failed to connect to Rhino Compute server: ${errorMessage}`);
	}

	try {
		// Fetch schema and IO in parallel — both are fast (no solve needed)
		const [definition, schema] = await Promise.all([
			client.getIO(definitionSource),
			fetchSchemaFromCompute(definitionSource, server)
		]);

		if (!definition) {
			throw new Error(
				`Failed to get definition IO - server returned undefined. Definition URL: ${clientDefUrl}`
			);
		}

		// Merge default values from Compute definition into schema inputs
		const computeInputsByParamId = new Map(definition.inputs.map((input) => [input.id, input]));

		schema.inputs = schema.inputs.map((schemaInput) => {
			const computeInput = computeInputsByParamId.get(schemaInput.id);

			// Special handling for Color parameters to convert default RGB/RGBA values to hex format
			if (computeInput?.paramType == 'Color' && computeInput.default !== undefined) {
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
		});

		return {
			schema,
			ghDefinition: clientDefUrl,
			currentDefinition: guid,
			serverLabel: server.label,
			// Forward to the client so /api/compute/solve calls can include it.
			// Null when the request was user-authenticated (session cookie carries auth).
			shareToken,
			// Same deadline the server enforces on /api/compute, so the client's
			// AbortController matches the server's Promise.race.
			solveTimeoutMs: MAX_SOLVE_DURATION_MS
		};
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		console.error('[PageLoad] Definition loading failed:', errorMessage);

		if (process.env.NODE_ENV === 'development') {
			const hint = `\n\nTroubleshooting:\n1. Check /api/health/compute to diagnose server connectivity\n2. Check the browser console for more details`;
			throw error(500, `Failed to load definition from ${clientDefUrl}: ${errorMessage}${hint}`);
		}

		throw error(500, `Failed to load definition: ${errorMessage}`);
	}
}) satisfies PageServerLoad;
