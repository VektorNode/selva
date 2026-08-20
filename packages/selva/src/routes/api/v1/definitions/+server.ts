import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { getDefinitionService } from '$lib/server/providers.server';
import { requireCanCreateDefinition } from '$lib/server/access.server';
import { apiError, ApiErrorCode, throwZodError } from '$lib/server/api-errors';
import { CreateDefinitionInputSchema } from '@selvajs/platform/definitions';
import {
	GH_EXTENSIONS,
	MAX_DEFINITION_FILE_SIZE,
	MAX_IMAGE_FILE_SIZE
} from '$lib/server/admin-config';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';
import {
	listVisibleDefinitions,
	resolveAccessibleProjects
} from '$lib/server/definitions/visibility.server';
import { parseDefinitionListOptions } from '$lib/server/pagination.server';
import { toDefinitionListItem, type DefinitionStatus } from '@selvajs/platform';
import {
	apiRoute,
	collection,
	created,
	formText,
	requireCaller,
	requireUpload
} from '$lib/server/api/v1/route';

const LISTABLE_STATUSES: DefinitionStatus[] = ['draft', 'published', 'archived'];

/**
 * Definitions the caller can view. Visibility is resolved into the query via
 * `projectIds`, so `limit`/`nextCursor` describe the filtered set.
 */
export const GET: RequestHandler = apiRoute(
	'Failed to list definitions',
	async ({ locals, url }) => {
		const { ctx } = requireCaller(locals);

		const statusParam = url.searchParams.get('status');
		if (statusParam && !LISTABLE_STATUSES.includes(statusParam as DefinitionStatus)) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				`status must be one of: ${LISTABLE_STATUSES.join(', ')}`
			);
		}

		const page = await listVisibleDefinitions(ctx, {
			...parseDefinitionListOptions(url),
			projectId: url.searchParams.get('projectId') ?? undefined,
			statuses: statusParam ? [statusParam as DefinitionStatus] : undefined
		});
		return collection({ items: page.items.map(toDefinitionListItem), nextCursor: page.nextCursor });
	}
);

function parseTags(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;
	const tags = raw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	return tags.length ? tags : undefined;
}

/** Create a definition — metadata and the Grasshopper file in one request. */
export const POST: RequestHandler = apiRoute(
	'Failed to create definition',
	async ({ request, locals }) => {
		const ctx = locals.ctx!;
		const form = await request.formData();

		const { file, extension } = requireUpload(form, 'file', {
			maxBytes: MAX_DEFINITION_FILE_SIZE,
			extensions: GH_EXTENSIONS,
			label: 'Grasshopper (.gh or .ghx) file'
		});

		const imageFile = form.get('image');
		if (imageFile instanceof File && imageFile.size > MAX_IMAGE_FILE_SIZE) {
			apiError(
				400,
				ApiErrorCode.VALIDATION_FAILED,
				`Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`
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
			const { projects } = await resolveAccessibleProjects(ctx);
			const fallback = projects.find((p) => p.orgId === ctx.actingOrgId);
			if (!fallback) {
				apiError(400, ApiErrorCode.VALIDATION_FAILED, 'No accessible project — pass projectId.');
			}
			projectId = fallback.id;
		}

		const { project } = await requireCanCreateDefinition(locals, projectId);

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
		const server = await resolveServerForOrg(ctx, project.orgId, {
			definitionPin: parsed.data.computeServerId ?? null
		});
		const schema = await fetchSchemaFromCompute(fileData, server);

		const { record, version } = await getDefinitionService().create(
			ctx,
			{
				guid,
				projectId: parsed.data.projectId,
				ownerId: locals.user!.id,
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
			coverImage = await getDefinitionService().saveCoverImage(ctx, guid, imageData);
		}

		return created({ guid, version, coverImage });
	}
);
