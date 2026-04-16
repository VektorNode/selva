import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { getDefinitionFiles, getDefinitionMeta } from '$lib/server/definitions.server';
import { CreateDefinitionInputSchema } from '@selva/platform/definitions/schemas';
import { GH_EXTENSIONS, MAX_GH_FILE_SIZE, MAX_IMAGE_FILE_SIZE } from '$lib/server/admin-config';

// POST - Create a new definition (metadata + GH file in one request)
export const POST: RequestHandler = async ({ request }) => {
	const files = getDefinitionFiles();
	const meta = getDefinitionMeta();

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

	const parsed = CreateDefinitionInputSchema.safeParse({
		displayName: formData.get('displayName'),
		description: formData.get('description') || undefined,
		category: formData.get('category') || undefined,
		coverImage: formData.get('coverImage') || undefined,
		tags: tags.length > 0 ? tags : undefined
	});

	if (!parsed.success) {
		throw error(400, parsed.error.issues[0].message);
	}

	// Optional image upload in the same request
	const imageFormFile = formData.get('image');
	if (imageFormFile instanceof File && imageFormFile.size > MAX_IMAGE_FILE_SIZE) {
		throw error(400, `Image too large. Max size: ${MAX_IMAGE_FILE_SIZE / (1024 * 1024)} MB`);
	}

	const fileExt = ext.slice(1) as 'gh' | 'ghx';
	const guid = randomUUID();

	try {
		// Save the GH file
		const fileData = new Uint8Array(await file.arrayBuffer());
		await files.saveFile(guid, fileData, fileExt);

		// Handle optional cover image
		let coverImage: string | undefined = parsed.data.coverImage;
		if (imageFormFile instanceof File && imageFormFile.size > 0) {
			const imageData = new Uint8Array(await imageFormFile.arrayBuffer());
			await files.saveImage(guid, imageData);
			coverImage = files.getCoverImageUrl(guid);
		}

		// Create the metadata record
		await meta.create({
			guid,
			fileExt,
			meta: {
				displayName: parsed.data.displayName.trim(),
				description: parsed.data.description,
				category: parsed.data.category,
				tags: parsed.data.tags,
				coverImage,
				originalFilename: file.name
			},
			history: [],
			maxHistory: 0,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString()
		});

		return json({ success: true, guid, filename: `definition.${fileExt}`, coverImage });
	} catch (err) {
		console.error('[Definitions POST] Failed to create definition:', err);
		throw error(500, 'Failed to create definition');
	}
};
