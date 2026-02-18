import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, rm } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getDefinitionsPath(): string {
  const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
  return resolve(process.cwd(), envPath);
}

// DELETE - Remove a definition: deletes the entire GUID folder and config entry
export const DELETE: RequestHandler = async ({ params }) => {
  const { guid } = params;

  if (!guid || !UUID_REGEX.test(guid)) {
    throw error(400, 'Invalid or missing GUID');
  }

  const definitionsPath = getDefinitionsPath();
  const configPath = join(definitionsPath, 'definitions-config.json');
  const guidFolderPath = join(definitionsPath, guid);

  try {
    // Remove from config
    try {
      const configData = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);
      if (config.definitions?.[guid]) {
        delete config.definitions[guid];
        await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
      }
    } catch (configErr) {
      console.warn('[Definition DELETE] Could not update config:', configErr);
    }

    // Delete the entire GUID folder
    await rm(guidFolderPath, { recursive: true, force: true });

    return json({ success: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('[Definition DELETE] Failed:', err);
    throw error(500, 'Failed to delete definition');
  }
};

// PUT - Update metadata only (not the file)
export const PUT: RequestHandler = async ({ params, request }) => {
  const { guid } = params;

  if (!guid || !UUID_REGEX.test(guid)) {
    throw error(400, 'Invalid or missing GUID');
  }

  const definitionsPath = getDefinitionsPath();
  const configPath = join(definitionsPath, 'definitions-config.json');

  try {
    const body = await request.json();
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);

    if (!config.definitions?.[guid]) {
      throw error(404, 'Definition not found');
    }

    const existing = config.definitions[guid];

    // Merge – preserve `file` field, update only metadata
    config.definitions[guid] = {
      ...existing,
      displayName: body.displayName ?? existing.displayName,
      description: body.description ?? existing.description,
      ...(body.category !== undefined ? { category: body.category } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.coverImage !== undefined ? { coverImage: body.coverImage } : {})
    };

    await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
    return json({ success: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    console.error('[Definition PUT] Failed:', err);
    throw error(500, 'Failed to update definition');
  }
};
