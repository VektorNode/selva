import { json, error } from '@sveltejs/kit';
import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const CONFIG_FILENAME = 'definitions-config.json';

// GET - Read config
export const GET: RequestHandler = async () => {
  const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
  const definitionsPath = resolve(process.cwd(), envPath);
  const configPath = join(definitionsPath, CONFIG_FILENAME);

  try {
    const configData = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(configData);
    // Handle both flat and nested structures
    const config = parsed.definitions || parsed;
    return json(config);
  } catch (err) {
    console.error('Failed to read config:', err);
    // Return empty config if file doesn't exist
    return json({});
  }
};

// PUT - Update config
export const PUT: RequestHandler = async ({ request }) => {
  const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
  const definitionsPath = resolve(process.cwd(), envPath);
  const configPath = join(definitionsPath, CONFIG_FILENAME);

  try {
    const config = await request.json();

    // Validate it's an object
    if (!config || typeof config !== 'object') {
      throw error(400, 'Invalid config format');
    }

    // Wrap config in definitions object to maintain expected structure
    const wrappedConfig = { definitions: config };

    // Write config with pretty formatting
    await writeFile(configPath, JSON.stringify(wrappedConfig, null, '\t'), 'utf-8');

    return json({ success: true });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    console.error('Failed to write config:', err);
    throw error(500, 'Failed to save configuration');
  }
};
