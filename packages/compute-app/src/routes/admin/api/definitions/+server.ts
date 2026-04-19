import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { definitionService, getOrganizationProvider } from '$lib/server/providers.server';
import { requireCanEdit } from '$lib/server/access.server';
import { CreateDefinitionInputSchema } from '@selva/platform/definitions/schemas';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST - Create a new definition (metadata + GH file in one request)
export const POST: RequestHandler = async ({ request, locals }) => {
	const ctx = locals.ctx!;
	const formData = await request.formData();
	const file = formData.get('file');

	if (!file || !(file instanceof File)) {
		throw error(400, 'A Grasshopper (.gh or .ghx) file is required');
	}

	const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (!GH_EXTENSIONS.includes(ext)) {
		throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
	}

	if (file.size > MAX_GH_FILE_SIZE) {
		throw error(400, `File too large. Max size: ${MAX_GH_FILE_SIZE / (1024 * 1024)} MB`);
	}

	const tagsRaw = (formData.get('tags') as string) || '';
	const tags = tagsRaw
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);

	const orgs = getOrganizationProvider();
	const orgsPage = await orgs.listOrgs(ctx, { limit: 1 });
	const defaultOrg = orgsPage.items[0];
	if (!defaultOrg) throw error(500, 'No organization configured');
	const projectsPage = await orgs.listProjects(ctx, defaultOrg.id, { limit: 1 });
	const defaultProject = projectsPage.items[0];
	if (!defaultProject) throw error(500, 'No project configured');

	const targetProjectId = (formData.get('projectId') as string) || defaultProject.id;
	await requireCanEdit(locals, targetProjectId);

	const parsed = CreateDefinitionInputSchema.safeParse({
		displayName: formData.get('displayName'),
		description: formData.get('description') || undefined,
		category: formData.get('category') || undefined,
		coverImage: formData.get('coverImage') || undefined,
		tags: tags.length > 0 ? tags : undefined,
		projectId: formData.get('projectId') || defaultProject.id,
		computeServerId: formData.get('computeServerId') || undefined
	});

	if (!parsed.success) {
		throw error(400, parsed.error.issues[0].message);
	}

	const imageFormFile = formData.get('image');
	if (imageFormFile instanceof File && imageFormFile.size > MAX_IMAGE_FILE_SIZE) {
		throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
	}

	const fileExt = ext.slice(1) as 'gh' | 'ghx';
	const guid = randomUUID();

	try {
		const fileData = new Uint8Array(await file.arrayBuffer());
		const record = await definitionService.create(
			ctx,
			{
				guid,
				projectId: parsed.data.projectId,
				ownerId: locals.user!.id,
				fileExt,
				computeServerId: parsed.data.computeServerId,
				meta: {
					displayName: parsed.data.displayName.trim(),
					description: parsed.data.description,
					category: parsed.data.category,
					tags: parsed.data.tags,
					originalFilename: file.name
				}
			},
			fileData
		);

		// Handle optional cover image
		if (imageFormFile instanceof File && imageFormFile.size > 0) {
			const imageData = new Uint8Array(await imageFormFile.arrayBuffer());
			await definitionService.saveCoverImage(ctx, guid, imageData);
		}

		return json({ success: true, guid, filename: `definition.${fileExt}`, coverImage: record.meta.coverImage });
	} catch (err) {
		console.error('[Definitions POST] Failed to create definition:', err);
		throw error(500, 'Failed to create definition');
	}
};
