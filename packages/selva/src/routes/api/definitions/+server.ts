import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { definitionService, getProjectProvider } from '$lib/server/providers.server';
import { requireCanCreateDefinition } from '$lib/server/access.server';
import { handleApiError, throwZodError } from '$lib/server/api-errors';
import { CreateDefinitionInputSchema } from '@selvajs/platform/definitions';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';
import { resolveServerForOrg } from '$lib/server/compute/resolve.server';
import { fetchSchemaFromCompute } from '$lib/server/definitions/schemaExtraction.server';

function parseTags(raw: unknown): string[] | undefined {
	if (typeof raw !== 'string' || !raw.trim()) return undefined;
	const tags = raw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	return tags.length ? tags : undefined;
}

// POST - Create a new definition (metadata + GH file in one request)
export const POST: RequestHandler = async ({ request, locals }) => {
	const ctx = locals.ctx!;
	const formData = await request.formData();

	const file = formData.get('file');
	if (!(file instanceof File)) {
		throw error(400, 'A Grasshopper (.gh or .ghx) file is required');
	}

	const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (!GH_EXTENSIONS.includes(ext)) {
		throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
	}
	if (file.size > MAX_GH_FILE_SIZE) {
		throw error(400, `File too large. Max size: ${MAX_GH_FILE_SIZE / (1024 * 1024)} MB`);
	}

	const imageFile = formData.get('image');
	if (imageFile instanceof File && imageFile.size > MAX_IMAGE_FILE_SIZE) {
		throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
	}

	let projectId = formData.get('projectId');
	if (typeof projectId !== 'string' || !projectId) {
		// Fall back to the first project of the active org.
		if (!ctx.actingOrgId) throw error(400, 'No active organization');
		const projectsPage = await getProjectProvider().listProjects(ctx, ctx.actingOrgId, {
			limit: 1
		});
		const defaultProject = projectsPage.items[0];
		if (!defaultProject) throw error(500, 'No project configured');
		projectId = defaultProject.id;
	}

	const { project } = await requireCanCreateDefinition(locals, projectId);

	const parsed = CreateDefinitionInputSchema.safeParse({
		displayName: formData.get('displayName'),
		description: formData.get('description') || undefined,
		category: formData.get('category') || undefined,
		coverImage: formData.get('coverImage') || undefined,
		tags: parseTags(formData.get('tags')),
		projectId,
		computeServerId: formData.get('computeServerId') || undefined
	});
	if (!parsed.success) throwZodError(parsed.error);

	const fileExt = ext.slice(1) as 'gh' | 'ghx';
	const guid = randomUUID();

	try {
		const fileData = new Uint8Array(await file.arrayBuffer());

		// Validate-and-cache gate: extract the schema from compute BEFORE any
		// write. A failure here (compute down / no valid Schema output) rejects
		// the upload with nothing persisted. See specs/SchemaCaching.md.
		const server = await resolveServerForOrg(ctx, project.orgId, {
			definitionPin: parsed.data.computeServerId ?? null
		});
		const schema = await fetchSchemaFromCompute(fileData, server);

		const { record, version } = await definitionService.create(
			ctx,
			{
				guid,
				projectId: parsed.data.projectId,
				ownerId: locals.user!.id,
				fileExt,
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
			coverImage = await definitionService.saveCoverImage(ctx, guid, imageData);
		}

		return json({ success: true, guid, version, coverImage });
	} catch (err) {
		handleApiError(err, 'Failed to create definition');
	}
};
