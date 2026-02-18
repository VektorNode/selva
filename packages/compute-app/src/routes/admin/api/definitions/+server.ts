import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getDefinitionStore } from '$lib/server/definitions.server';
import { CreateDefinitionInputSchema } from '$lib/server/definitions/schemas';

const GH_EXTENSIONS = ['.gh', '.ghx'];

// POST - Create a new definition (metadata + GH file in one request)
export const POST: RequestHandler = async ({ request }) => {
	const store = getDefinitionStore();

	try {
		const formData = await request.formData();
		const file = formData.get('file');

		if (!file || !(file instanceof File)) {
			throw error(400, 'A Grasshopper (.gh or .ghx) file is required');
		}

		const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!GH_EXTENSIONS.includes(ext)) {
			throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
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
		const imageFile =
			imageFormFile instanceof File && imageFormFile.size > 0
				? { name: imageFormFile.name, data: await imageFormFile.arrayBuffer() }
				: null;

		const result = await store.createDefinition(
			{
				...parsed.data,
				file: { name: file.name, data: await file.arrayBuffer() }
			},
			imageFile
		);

		return json({ success: true, ...result });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Definitions POST] Failed to create definition:', err);
		throw error(500, 'Failed to create definition');
	}
};
