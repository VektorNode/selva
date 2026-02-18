import { json, error } from '@sveltejs/kit';
import { readdir, unlink, writeFile, readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const ALLOWED_EXTENSIONS = ['.gh', '.ghx', '.jpg', '.jpeg', '.png', '.gif', '.webp'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

// GET - List all files
export const GET: RequestHandler = async () => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	try {
		const files = await readdir(definitionsPath);
		return json({ files });
	} catch (err) {
		console.error('Failed to read directory:', err);
		throw error(500, 'Failed to read definitions directory');
	}
};

// POST - Upload a file
export const POST: RequestHandler = async ({ request }) => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	try {
		const formData = await request.formData();
		const file = formData.get('file');

		if (!file || !(file instanceof File)) {
			throw error(400, 'No file provided');
		}

		// Validate file extension
		const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!ALLOWED_EXTENSIONS.includes(extension)) {
			throw error(400, `File type not allowed. Allowed types: ${ALLOWED_EXTENSIONS.join(', ')}`);
		}

		// Read file as buffer
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// Write to definitions directory
		const filePath = join(definitionsPath, file.name);
		await writeFile(filePath, buffer);

		return json({ success: true, filename: file.name });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('Failed to upload file:', err);
		throw error(500, 'Failed to upload file');
	}
};

// DELETE - Delete a file
export const DELETE: RequestHandler = async ({ url }) => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);
	const filename = url.searchParams.get('filename');

	if (!filename) {
		throw error(400, 'Filename is required');
	}

	// Prevent directory traversal
	if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	try {
		const filePath = join(definitionsPath, filename);

		// Check if it's an image file
		const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
		const isImage = IMAGE_EXTENSIONS.includes(ext);

		// If it's an image, remove it from all definitions in config
		if (isImage) {
			try {
				const configPath = join(definitionsPath, 'definitions-config.json');
				const configData = await readFile(configPath, 'utf-8');
				const config = JSON.parse(configData);

				// Check if config has definitions
				if (config.definitions && typeof config.definitions === 'object') {
					let hasChanges = false;

					// Iterate through all definitions and clear coverImage if it matches
					for (const [key, definition] of Object.entries(config.definitions)) {
						if (
							typeof definition === 'object' &&
							definition !== null &&
							'coverImage' in definition &&
							definition.coverImage === filename
						) {
							definition.coverImage = '';
							hasChanges = true;
							console.log(`[FileDelete] Cleared coverImage for definition: ${key}`);
						}
					}

					// Write back if changes were made
					if (hasChanges) {
						await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
						console.log(`[FileDelete] Updated definitions-config.json after deleting image: ${filename}`);
					}
				}
			} catch (configErr) {
				// Log but don't fail - the file still gets deleted
				console.warn(`[FileDelete] Could not update config after deleting image: ${configErr}`);
			}
		}

		// Delete the actual file
		await unlink(filePath);
		return json({ success: true });
	} catch (err) {
		console.error('Failed to delete file:', err);
		throw error(500, 'Failed to delete file');
	}
};
