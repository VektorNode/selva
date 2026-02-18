import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { IMAGE_CONTENT_TYPES } from '$lib/server/admin-config';

export const GET: RequestHandler = async ({ params }) => {
	const definitionsPath = resolve(process.cwd(), env.GH_DEFINITIONS_PATH || './definitions');
	const filename = params.filename;

	if (!filename) {
		throw error(400, 'Filename is required');
	}

	// Validate it's an image file
	const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_CONTENT_TYPES[extension];

	if (!contentType) {
		throw error(400, 'File is not a supported image type');
	}

	// Prevent directory traversal: resolved path must stay inside definitionsPath
	const filePath = resolve(definitionsPath, filename);
	if (!filePath.startsWith(definitionsPath + '/') && filePath !== definitionsPath) {
		throw error(400, 'Invalid filename');
	}

	try {
		const fileBuffer = await readFile(filePath);

		return new Response(fileBuffer, {
			headers: {
				'Content-Type': contentType,
				'Cache-Control': 'public, max-age=31536000'
			}
		});
	} catch (err) {
		console.error('Failed to read image:', err);
		throw error(404, 'Image not found');
	}
};
