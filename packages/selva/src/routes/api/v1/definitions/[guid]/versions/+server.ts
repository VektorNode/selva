import type { RequestHandler } from './$types';
import { getDefinitionMeta, getDefinitionService } from '$lib/server/providers.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { requireCanViewProject, requireEditableDefinition } from '$lib/server/access.server';
import { GuidSchema } from '@selvajs/platform/definitions';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE } from '$lib/server/admin-config';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';
import { parseListOptions } from '$lib/server/pagination.server';
import {
	apiRoute,
	collection,
	created,
	formText,
	parseParam,
	requireUpload
} from '$lib/server/api/v1/route';

export const GET: RequestHandler = apiRoute(
	'Failed to list versions',
	async ({ params, locals, url }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		if (!locals.ctx) apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');

		const def = await getDefinitionMeta().get(locals.ctx, guid);
		if (!def) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
		await requireCanViewProject(locals, def.projectId);

		return collection(
			await getDefinitionMeta().listVersions(locals.ctx, guid, parseListOptions(url))
		);
	}
);

/**
 * Upload a new version. Advances `draft`; `live` is unchanged until publish.
 */
export const POST: RequestHandler = apiRoute(
	'Failed to upload definition version',
	async ({ params, request, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');

		const form = await request.formData();
		const { file, extension } = requireUpload(form, 'file', {
			maxBytes: MAX_GH_FILE_SIZE,
			extensions: GH_EXTENSIONS,
			label: 'Grasshopper (.gh or .ghx) file'
		});
		const changeNote = formText(form, 'changeNote', { maxLength: 1000 });

		const { ctx, record, project } = await requireEditableDefinition(locals, guid);
		const data = new Uint8Array(await file.arrayBuffer());

		// Validate-and-cache gate: extract the schema from compute BEFORE any
		// write, so a failure rejects the upload with nothing persisted.
		// `project` comes from the guard — no re-fetch.
		const server = await resolveServerForOrg(ctx, project?.orgId ?? null, {
			definitionPin: record.computeServerId ?? null
		});
		const schema = await fetchSchemaFromCompute(data, server);

		const version = await getDefinitionService().uploadVersion(
			ctx,
			guid,
			data,
			extension.slice(1) as 'gh' | 'ghx',
			file.name,
			schema,
			changeNote
		);
		return created({ version });
	}
);
