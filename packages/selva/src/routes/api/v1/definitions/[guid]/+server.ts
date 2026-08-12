import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDefinitionMeta, getDefinitionService } from '$lib/server/providers.server';
import { requireEditableDefinition } from '$lib/server/access.server';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { GuidSchema, UpdateMetadataInputSchema } from '@selvajs/platform/definitions';
import type { DefinitionVersion } from '@selvajs/platform';
import { getVisibleDefinition } from '$lib/server/definitions/visibility.server';
import {
	apiRoute,
	noContent,
	parseBody,
	parseParam,
	requireCaller
} from '$lib/server/api/v1/route';

/** `schema` is a large blob, served on demand by `/versions/{versionId}/schema`. */
function versionSummary(v: DefinitionVersion) {
	return {
		id: v.id,
		versionNumber: v.versionNumber,
		uploadedAt: v.uploadedAt,
		uploadedBy: v.uploadedBy,
		changeNote: v.changeNote
	};
}

/** The record plus its live and draft version summaries. */
export const GET: RequestHandler = apiRoute(
	'Failed to load definition',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = requireCaller(locals);

		const record = await getVisibleDefinition(ctx, guid);
		if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');

		const meta = getDefinitionMeta();
		const [liveVersion, draftVersion] = await Promise.all([
			record.liveVersionId ? meta.getVersion(ctx, record.liveVersionId) : null,
			record.draftVersionId ? meta.getVersion(ctx, record.draftVersionId) : null
		]);

		return json({
			...record,
			liveVersion: liveVersion ? versionSummary(liveVersion) : null,
			draftVersion: draftVersion ? versionSummary(draftVersion) : null
		});
	}
);

/** Soft-delete the definition; versions and blobs are wiped with it. */
export const DELETE: RequestHandler = apiRoute(
	'Failed to delete definition',
	async ({ params, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = await requireEditableDefinition(locals, guid);

		await getDefinitionService().delete(ctx, guid);
		return noContent();
	}
);

/** Metadata only. New versions POST to `/versions`. */
export const PATCH: RequestHandler = apiRoute(
	'Failed to update definition',
	async ({ params, request, locals }) => {
		const guid = parseParam(params.guid, GuidSchema, 'GUID');
		const { ctx } = await requireEditableDefinition(locals, guid);
		const patch = await parseBody(request, UpdateMetadataInputSchema);

		await getDefinitionService().updateMeta(ctx, guid, patch);
		return noContent();
	}
);
