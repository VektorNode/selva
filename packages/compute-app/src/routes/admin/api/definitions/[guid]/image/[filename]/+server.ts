import { error } from '@sveltejs/kit';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
};

// GET /admin/api/definitions/{guid}/image/{filename} — serve a stored cover image
export const GET: RequestHandler = async ({ params }) => {
  const { guid, filename } = params;

  if (!guid || !UUID_REGEX.test(guid)) throw error(400, 'Invalid GUID');
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw error(400, 'Invalid filename');
  }

  const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
  const contentType = IMAGE_EXTENSIONS[ext];
  if (!contentType) throw error(400, 'Unsupported image type');

  const definitionsPath = resolve(process.cwd(), env.GH_DEFINITIONS_PATH || './example-definitions');
  const filePath = join(definitionsPath, guid, filename);

  try {
    const buffer = await readFile(filePath);
    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch {
    throw error(404, 'Image not found');
  }
};
