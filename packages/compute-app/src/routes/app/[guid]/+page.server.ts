import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { GrasshopperClient } from 'selva-compute/grasshopper';
import { camelcaseKeys } from 'selva-compute/core';
import type { UISchema } from 'selva-shared';
import { getServerConfig, getComputeServerConfigStore } from '$lib/server/compute/config.server';
import { resolveComputeServer, SYSTEM_CONTEXT } from '@selva/platform';
import {
	getStorageProvider,
	getDefinitionMeta,
	getOrganizationProvider,
	getProjectProvider
} from '$lib/server/providers.server';

/**
 * Check if a user can access a definition based on project visibility.
 * Throws 401 if not authenticated, 403 if no access.
 */
async function checkDefinitionAccess(
	userId: string | undefined,
	projectId: string
): Promise<void> {
	if (!userId) {
		throw error(401, 'Unauthorized: You must be logged in to access definitions');
	}

	const projects = getProjectProvider();
	const orgs = getOrganizationProvider();
	const project = await projects.getProject(SYSTEM_CONTEXT, projectId);

	if (!project) {
		throw error(404, 'Project not found');
	}

	if (project.visibility === 'public') {
		return;
	}

	if (project.visibility === 'org') {
		const member = await orgs.getOrgMember(SYSTEM_CONTEXT, project.orgId, userId);
		if (!member) {
			throw error(
				403,
				`Forbidden: This definition belongs to an organization you are not a member of`
			);
		}
		return;
	}

	if (project.visibility === 'private') {
		const member = await projects.getProjectMember(SYSTEM_CONTEXT, projectId, userId);
		if (!member) {
			throw error(403, `Forbidden: This definition is private and you are not a project member`);
		}
		return;
	}
}

/**
 * Fetch UI schema from Rhino Compute's /grasshopper/schema endpoint (no solve required).
 */
async function fetchSchemaFromCompute(
	definitionBytes: Uint8Array,
	config: { computeServerUrl: string; computeApiKey?: string }
): Promise<UISchema> {
	const schemaUrl = new URL('/grasshopper/schema', config.computeServerUrl).toString();

	const formData = new FormData();
	const blob = new Blob([new Uint8Array(definitionBytes)], { type: 'application/octet-stream' });
	formData.append('file', blob, 'definition.gh');

	const headers: Record<string, string> = {};
	if (config.computeApiKey) {
		headers['RhinoComputeKey'] = config.computeApiKey;
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

export const load = (async ({ params, locals }) => {
	const config = getServerConfig();
	const storage = getStorageProvider();
	const meta = getDefinitionMeta();

	const guid = params.guid;

	let definitionSource: Uint8Array;
	const clientDefUrl = `local:${guid}`;

	try {
		const record = await meta.get(SYSTEM_CONTEXT, guid);
		if (!record) throw new Error(`Definition '${guid}' not found`);

		// Check access based on project visibility
		await checkDefinitionAccess(locals.user?.id, record.projectId);

		const bytes = await storage.get(`definitions/${guid}/definition.${record.fileExt}`);
		if (!bytes) throw new Error(`Definition file for '${guid}' not found on disk`);

		definitionSource = bytes;
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
			serverUrl: config.computeServerUrl,
			apiKey: config.computeApiKey
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
			fetchSchemaFromCompute(definitionSource, config)
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

		const computeConfig = await getComputeServerConfigStore().getConfig(SYSTEM_CONTEXT);
		const server = computeConfig.servers.length > 0 ? resolveComputeServer(computeConfig) : undefined;

		return {
			schema,
			ghDefinition: clientDefUrl,
			currentDefinition: guid,
			serverLabel: server?.label ?? null
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
