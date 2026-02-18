import { json, error } from '@sveltejs/kit';
import { writeFile, readFile } from 'fs/promises';
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

function getDefinitionsPath(): string {
  return resolve(process.cwd(), env.GH_DEFINITIONS_PATH || './example-definitions');
}

// POST /admin/api/definitions/{guid}/image — upload a cover image into the GUID folder
export const POST: RequestHandler = async ({ params, request }) => {
  const { guid } = params;
  if (!guid || !UUID_REGEX.test(guid)) throw error(400, 'Invalid GUID');

  const definitionsPath = getDefinitionsPath();
  const configPath = join(definitionsPath, 'definitions-config.json');
  const guidPath = join(definitionsPath, guid);

  try {
    const formData = await request.formData();
    const file = formData.get('image');

    if (!file || !(file instanceof File) || file.size === 0) {
      throw error(400, 'Image file is required');
    }

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!IMAGE_EXTENSIONS[ext]) {
      throw error(400, `Unsupported image type. Allowed: ${Object.keys(IMAGE_EXTENSIONS).join(', ')}`);
    }

    // Sanitise filename
    const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const coverImage = `/admin/api/definitions/${guid}/image/${filename}`;

    // Save the image file into the GUID folder
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(guidPath, filename), buffer);

    // Update config
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    if (!config.definitions?.[guid]) throw error(404, 'Definition not found');

    config.definitions[guid].coverImage = coverImage;
    await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');

    return json({ success: true, coverImage });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('[Image POST] Failed:', err);
    throw error(500, 'Failed to upload image');
  }
};
