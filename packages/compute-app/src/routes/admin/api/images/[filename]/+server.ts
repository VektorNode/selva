import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const IMAGE_EXTENSIONS: Record<string, string> = {
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.png': 'image/png',
	'.gif': 'image/gif',
	'.webp': 'image/webp'
};

export const GET: RequestHandler = async ({ params }) => {
	const definitionsPath = resolve(process.cwd(), env.GH_DEFINITIONS_PATH || './definitions');
	const filename = params.filename;

	if (!filename) {
		throw error(400, 'Filename is required');
	}

	// Prevent directory traversal
	if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
		throw error(400, 'Invalid filename');
	}

	// Validate it's an image file
	const extension = filename.substring(filename.lastIndexOf('.')).toLowerCase();
	const contentType = IMAGE_EXTENSIONS[extension];

	if (!contentType) {
		throw error(400, 'File is not a supported image type');
	}

	try {
		const filePath = join(definitionsPath, filename);
		console.log('Reading image from:', filePath);
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
