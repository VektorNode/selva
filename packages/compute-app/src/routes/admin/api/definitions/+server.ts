import { json, error } from '@sveltejs/kit';
import { writeFile, readFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';

const GH_EXTENSIONS = ['.gh', '.ghx'];

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// POST - Create a new definition (metadata + GH file in one request)
export const POST: RequestHandler = async ({ request }) => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const displayName = formData.get('displayName') as string | null;
		const description = (formData.get('description') as string) || '';
		const category = (formData.get('category') as string) || '';
		const tagsRaw = (formData.get('tags') as string) || '';
		const coverImage = (formData.get('coverImage') as string) || '';

		if (!file || !(file instanceof File)) {
			throw error(400, 'A Grasshopper (.gh or .ghx) file is required');
		}

		if (!displayName?.trim()) {
			throw error(400, 'Display name is required');
		}

		const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!GH_EXTENSIONS.includes(extension)) {
			throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
		}

		// Generate GUID and create folder
		const guid = randomUUID();
		const guidPath = join(definitionsPath, guid);
		await mkdir(guidPath, { recursive: true });

		// Write the GH file
		const arrayBuffer = await file.arrayBuffer();
		await writeFile(join(guidPath, file.name), Buffer.from(arrayBuffer));

		// Optionally save a cover image uploaded in the same request
		let resolvedCoverImage = coverImage;
		const imageFile = formData.get('image');
		if (imageFile instanceof File && imageFile.size > 0) {
			const imageExt = imageFile.name.substring(imageFile.name.lastIndexOf('.')).toLowerCase();
			if (IMAGE_EXTENSIONS.includes(imageExt)) {
				const safeImageName = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
				await writeFile(join(guidPath, safeImageName), Buffer.from(await imageFile.arrayBuffer()));
				resolvedCoverImage = `/admin/api/definitions/${guid}/image/${safeImageName}`;
			}
		}

		// Update config
		const configPath = join(definitionsPath, 'definitions-config.json');
		let config: { definitions: Record<string, unknown> } = { definitions: {} };
		try {
			const configData = await readFile(configPath, 'utf-8');
			config = JSON.parse(configData);
			if (!config.definitions) config.definitions = {};
		} catch {
			// config doesn't exist yet – start fresh
		}

		const tags = tagsRaw
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);

		config.definitions[guid] = {
			displayName: displayName.trim(),
			description,
			...(category ? { category } : {}),
			...(tags.length > 0 ? { tags } : {}),
			...(resolvedCoverImage ? { coverImage: resolvedCoverImage } : {}),
			file: file.name
		};

		await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');

		return json({ success: true, guid, filename: file.name });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Definitions POST] Failed to create definition:', err);
		throw error(500, 'Failed to create definition');
	}
};

