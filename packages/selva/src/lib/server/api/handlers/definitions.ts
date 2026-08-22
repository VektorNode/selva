/**
 * Definition handlers: the collection, one definition's detail and metadata,
 * its live schema, cover image, and the publish channel.
 *
 * Solve and the two compute routes stay unwrapped deliberately — they stream
 * and mark their own metrics, which the `ApiResponse` envelope does not model.
 */

import { randomUUID } from 'node:crypto';
import {
	apiError,
	ApiErrorCode,
	collection,
	created,
	formText,
	noContent,
	parseBody,
	parseParam,
	requireUpload,
	throwZodError
} from '@selvajs/server/api';
import type { ApiHandler } from '@selvajs/server/api';
import { toDefinitionListItem, type DefinitionStatus } from '@selvajs/platform';
import {
	CreateDefinitionInputSchema,
	GuidSchema,
	PublishVersionInputSchema,
	UpdateMetadataInputSchema
} from '@selvajs/platform/definitions';
import type { DefinitionVersion } from '@selvajs/platform';
import { requireCanCreateDefinition, requireEditableDefinition } from '../../access.server';
import { GH_EXTENSIONS } from '@selvajs/platform';
import { resolveServerForOrg } from '../../compute/resolve.server';
import { fetchSchemaFromCompute } from '@selvajs/server/definitions';
import {
	getVisibleDefinition,
	listVisibleDefinitions,
	loadVisibleVersion,
	resolveAccessibleProjects
} from '../../definitions/visibility.server';
import { parseDefinitionListOptions } from '../../pagination.server';
import { requireCaller } from '../callers';
import { definitionService } from '@selvajs/server/handlers';

const LISTABLE_STATUSES: DefinitionStatus[] = ['draft', 'published', 'archived'];

/**
 * Definitions the caller can view. Visibility is resolved into the query via
 * `projectIds`, so `limit`/`nextCursor` describe the filtered set.
 */
export const listDefinitions: ApiHandler = async (req) => {
	const { ctx } = requireCaller(req);

	const statusParam = req.url.searchParams.get('status');
	if (statusParam && !LISTABLE_STATUSES.includes(statusParam as DefinitionStatus)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`status must be one of: ${LISTABLE_STATUSES.join(', ')}`
		);
	}

	const page = await listVisibleDefinitions(
		ctx,
		{
			...parseDefinitionListOptions(req.url),
			projectId: req.url.searchParams.get('projectId') ?? undefined,
			statuses: statusParam ? [statusParam as DefinitionStatus] : undefined
		},
		req.deps
	);
	return collection({ items: page.items.map(toDefinitionListItem), nextCursor: page.nextCursor });
};

function parseTags(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;
	const tags = raw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	return tags.length ? tags : undefined;
}

/** Create a definition — metadata and the Grasshopper file in one request. */
export const createDefinition: ApiHandler = async (req) => {
	const { ctx, user } = requireCaller(req);
	const form = await req.request.formData();

	const { file, extension } = requireUpload(form, 'file', {
		maxBytes: req.deps.uploadLimits.maxDefinitionFileSize,
		extensions: GH_EXTENSIONS,
		label: 'Grasshopper (.gh or .ghx) file'
	});

	const imageFile = form.get('image');
	const maxImageBytes = req.deps.uploadLimits.maxImageFileSize;
	if (imageFile instanceof File && imageFile.size > maxImageBytes) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Image too large. Max size: ${maxImageBytes / (1024 * 1024)} MB`
		);
	}

	let projectId = formText(form, 'projectId');
	if (!projectId) {
		// The fallback picks a project on the caller's behalf, so it must pick
		// from what the caller can already see. `listProjects` ignores its ctx on
		// the local provider, which would let the pick land on a `private`
		// project the caller is not a member of — and on an `autoJoinOnUpload`
		// project `requireCanCreateDefinition` then allows the write, so the
		// upload succeeds into a project the caller never named.
		if (!ctx.actingOrgId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No active organization');
		const { projects } = await resolveAccessibleProjects(ctx, req.deps);
		const fallback = projects.find((p) => p.orgId === ctx.actingOrgId);
		if (!fallback) {
			apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No accessible project — pass projectId.');
		}
		projectId = fallback.id;
	}

	const { project } = await requireCanCreateDefinition(req, projectId);

	// Not `parseBody` — the fields arrive as multipart, not JSON, so they are
	// assembled here and validated by the same schema.
	const parsed = CreateDefinitionInputSchema.safeParse({
		displayName: formText(form, 'displayName'),
		description: formText(form, 'description'),
		category: formText(form, 'category'),
		coverImage: formText(form, 'coverImage'),
		tags: parseTags(formText(form, 'tags')),
		projectId,
		computeServerId: formText(form, 'computeServerId')
	});
	if (!parsed.success) throwZodError(parsed.error);

	const guid = randomUUID();
	const fileData = new Uint8Array(await file.arrayBuffer());

	// Validate-and-cache gate: extract the schema from compute BEFORE any
	// write, so compute being down or the file having no Schema output rejects
	// the upload with nothing persisted.
	const server = await resolveServerForOrg(ctx, project.orgId, req.deps.computeServer, {
		definitionPin: parsed.data.computeServerId ?? null
	});
	const schema = await fetchSchemaFromCompute(fileData, server);

	const service = definitionService(req.deps);
	const { record, version } = await service.create(
		ctx,
		{
			guid,
			projectId: parsed.data.projectId,
			ownerId: user.id,
			fileExt: extension.slice(1) as 'gh' | 'ghx',
			originalFilename: file.name,
			computeServerId: parsed.data.computeServerId,
			displayName: parsed.data.displayName.trim(),
			description: parsed.data.description,
			category: parsed.data.category,
			tags: parsed.data.tags,
			coverImage: parsed.data.coverImage
		},
		fileData,
		schema
	);

	let coverImage = record.coverImage;
	if (imageFile instanceof File && imageFile.size > 0) {
		const imageData = new Uint8Array(await imageFile.arrayBuffer());
		coverImage = await service.saveCoverImage(ctx, guid, imageData);
	}

	return created({ guid, version, coverImage });
};

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
export const getDefinition: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = requireCaller(req);

	const record = await getVisibleDefinition(ctx, guid, req.deps);
	if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');

	const meta = req.deps.definitionMeta;
	const [liveVersion, draftVersion] = await Promise.all([
		record.liveVersionId ? meta.getVersion(ctx, record.liveVersionId) : null,
		record.draftVersionId ? meta.getVersion(ctx, record.draftVersionId) : null
	]);

	return {
		body: {
			...record,
			liveVersion: liveVersion ? versionSummary(liveVersion) : null,
			draftVersion: draftVersion ? versionSummary(draftVersion) : null
		}
	};
};

/** Soft-delete the definition; versions and blobs are wiped with it. */
export const deleteDefinition: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = await requireEditableDefinition(req, guid);

	await definitionService(req.deps).delete(ctx, guid);
	return noContent();
};

/** Metadata only. New versions POST to `/versions`. */
export const updateDefinition: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = await requireEditableDefinition(req, guid);
	const patch = await parseBody(req.request, UpdateMetadataInputSchema);

	await definitionService(req.deps).updateMeta(ctx, guid, patch);
	return noContent();
};

/**
 * Convenience alias for the live version's schema — the call a client makes
 * before solving. The canonical location is `/versions/{versionId}/schema`;
 * this resolves the `live` pointer for you.
 */
export const getDefinitionSchema: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = requireCaller(req);

	const record = await getVisibleDefinition(ctx, guid, req.deps);
	if (!record) apiError(404, ApiErrorCode.NOT_FOUND, 'Definition not found');
	if (!record.liveVersionId) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'This definition has no published version');
	}

	const version = await loadVisibleVersion(ctx, guid, record.liveVersionId, req.deps);
	if (!version?.schema) {
		apiError(404, ApiErrorCode.NOT_FOUND, 'No schema cached for the live version');
	}
	return { body: version.schema };
};

/**
 * Advance the live channel. Body `{ versionId? }` targets a specific version
 * (rollback or forward-roll); omit it to promote the current draft.
 */
export const publishDefinition: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { versionId } = await parseBody(req.request, PublishVersionInputSchema, { missingAs: {} });

	const { ctx } = await requireEditableDefinition(req, guid);
	return { body: { version: await definitionService(req.deps).publish(ctx, guid, versionId) } };
};

/** Upload a cover image. */
export const uploadDefinitionImage: ApiHandler = async (req) => {
	const guid = parseParam(req.params.guid, GuidSchema, 'GUID');
	const { ctx } = await requireEditableDefinition(req, guid);

	const { file } = requireUpload(await req.request.formData(), 'image', {
		maxBytes: req.deps.uploadLimits.maxImageFileSize,
		label: 'Image'
	});

	const data = new Uint8Array(await file.arrayBuffer());
	return {
		body: { coverImage: await definitionService(req.deps).saveCoverImage(ctx, guid, data) }
	};
};
