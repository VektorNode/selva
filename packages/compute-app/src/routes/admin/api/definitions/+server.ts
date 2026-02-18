import { json, error } from '@sveltejs/kit';
import { readdir, unlink, writeFile, readFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';

const GH_EXTENSIONS = ['.gh', '.ghx'];
const BACKUP_DIR = 'backups';

// POST - Upload/Update a GH definition file with backup and GUID support
export const POST: RequestHandler = async ({ request }) => {
  const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
  const definitionsPath = resolve(process.cwd(), envPath);
  const backupPath = join(definitionsPath, BACKUP_DIR);

  try {
    const formData = await request.formData();
    const file = formData.get('file');
    const isUpdate = formData.get('isUpdate') === 'true';
    const oldFilename = formData.get('oldFilename') as string | null;
    const defGuid = formData.get('guid') as string | null;

    if (!file || !(file instanceof File)) {
      throw error(400, 'No file provided');
    }

    // Validate file extension
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (!GH_EXTENSIONS.includes(extension)) {
      throw error(400, `File type not allowed. Allowed types: ${GH_EXTENSIONS.join(', ')}`);
    }

    // Read file as buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const newFilePath = join(definitionsPath, file.name);
    const guid = defGuid || randomUUID();

    // If updating and old file exists
    if (isUpdate && oldFilename && oldFilename !== file.name) {
      const oldFilePath = join(definitionsPath, oldFilename);

      // Create backup directory if it doesn't exist
      try {
        await mkdir(backupPath, { recursive: true });
      } catch (err) {
        console.warn('[Backup] Could not create backup directory:', err);
      }

      // Backup old file with timestamp
      try {
        const oldFileData = await readFile(oldFilePath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFilename = `${oldFilename.replace(/\.[^.]+$/, '')}_${timestamp}${extension}`;
        const backupFilePath = join(backupPath, backupFilename);

        await writeFile(backupFilePath, oldFileData);
        console.log(`[Backup] Created backup: ${backupFilename}`);

        // Delete the old file
        await unlink(oldFilePath);
        console.log(`[Backup] Deleted old file: ${oldFilename}`);
      } catch (backupErr) {
        console.warn('[Backup] Error during backup:', backupErr);
        // Continue anyway - the new file will still be written
      }
    }

    // Write the new file
    await writeFile(newFilePath, buffer);

    // Update the config to assign GUID if this is a definition
    try {
      const configPath = join(definitionsPath, 'definitions-config.json');
      const configData = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configData);

      if (!config.definitions) {
        config.definitions = {};
      }

      // Get the key for this definition (filename without extension)
      const defKey = file.name;

      // Update or create the definition entry with GUID
      if (!config.definitions[defKey]) {
        config.definitions[defKey] = {};
      }

      // Ensure it has a GUID
      if (!config.definitions[defKey].guid) {
        config.definitions[defKey].guid = guid;
      }

      // If old filename exists in config and it's different, copy config and remove old
      if (isUpdate && oldFilename && oldFilename !== file.name && config.definitions[oldFilename]) {
        // Transfer GUID to new file
        config.definitions[defKey].guid = config.definitions[oldFilename].guid;
        // Copy other metadata if it exists
        const oldDef = config.definitions[oldFilename];
        if (oldDef.displayName) config.definitions[defKey].displayName = oldDef.displayName;
        if (oldDef.description) config.definitions[defKey].description = oldDef.description;
        if (oldDef.category) config.definitions[defKey].category = oldDef.category;
        if (oldDef.tags) config.definitions[defKey].tags = oldDef.tags;
        if (oldDef.coverImage) config.definitions[defKey].coverImage = oldDef.coverImage;

        // Remove old entry
        delete config.definitions[oldFilename];
        console.log(`[Config] Migrated definition from ${oldFilename} to ${defKey}`);
      }

      await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
      console.log(`[Config] Updated definition config with GUID: ${config.definitions[defKey].guid}`);
    } catch (configErr) {
      console.warn('[Config] Could not update config:', configErr);
      // Don't fail - the file was still written
    }

    return json({
      success: true,
      filename: file.name,
      guid: guid,
      isUpdate: isUpdate
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    console.error('Failed to upload definition:', err);
    throw error(500, 'Failed to upload definition');
  }
};
