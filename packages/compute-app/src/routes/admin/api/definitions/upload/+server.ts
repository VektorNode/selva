import { json, error } from '@sveltejs/kit';
import { readdir, unlink, writeFile, readFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const GH_EXTENSIONS = ['.gh', '.ghx'];

// POST - Upload definition file to GUID-based folder structure
export const POST: RequestHandler = async ({ request }) => {
	const envPath = env.GH_DEFINITIONS_PATH || './example-definitions';
	const definitionsPath = resolve(process.cwd(), envPath);

	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const guid = formData.get('guid') as string | null;

		if (!file || !(file instanceof File)) {
			throw error(400, 'No file provided');
		}

		if (!guid) {
			throw error(400, 'Definition GUID is required');
		}

		// Validate file extension
		const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!GH_EXTENSIONS.includes(extension)) {
			throw error(400, `File type not allowed. Allowed types: ${GH_EXTENSIONS.join(', ')}`);
		}

		// Read file as buffer
		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		// Create GUID-based folder structure
		const guidFolderPath = join(definitionsPath, guid);
		const oldFilesFolderPath = join(guidFolderPath, 'old_files');
		const newFilePath = join(guidFolderPath, file.name);

		// Create main GUID folder if it doesn't exist
		try {
			await mkdir(guidFolderPath, { recursive: true });
			console.warn(`[Definition Upload] Created folder: ${guid}`);
		} catch (err) {
			console.warn('[Definition Upload] Could not create GUID folder:', err);
		}

		// Check if a grasshopper file already exists in this folder (and is different from new file)
		let oldFileInfo: { path: string; name: string } | null = null;
		try {
			const filesInFolder = await readdir(guidFolderPath);
			for (const fileName of filesInFolder) {
				if (fileName !== 'old_files' && GH_EXTENSIONS.includes(fileName.substring(fileName.lastIndexOf('.')))) {
					const oldPath = join(guidFolderPath, fileName);
					if (oldPath !== newFilePath) {
						oldFileInfo = { path: oldPath, name: fileName };
						break;
					}
				}
			}
		} catch (err) {
			console.warn('[Definition Upload] Could not check for existing files:', err);
		}

		// If there's an old file, back it up with timestamp
		if (oldFileInfo) {
			try {
				await mkdir(oldFilesFolderPath, { recursive: true });
				const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
				const oldFileData = await readFile(oldFileInfo.path);
				const oldFileNameNoExt = oldFileInfo.name.replace(/\.[^.]+$/, '');
				const backupFileName = `${oldFileNameNoExt}_${timestamp}${extension}`;
				const backupFilePath = join(oldFilesFolderPath, backupFileName);

				await writeFile(backupFilePath, oldFileData);
				console.warn(`[Definition Upload] Created backup: ${guid}/old_files/${backupFileName}`);

				// Delete the old file
				await unlink(oldFileInfo.path);
				console.warn(`[Definition Upload] Deleted old file: ${oldFileInfo.name}`);
			} catch (backupErr) {
				console.warn('[Definition Upload] Error during backup:', backupErr);
				// Continue anyway - the new file will still be written
			}
		}

		// Write the new file
		await writeFile(newFilePath, buffer);
		console.warn(`[Definition Upload] Written new file: ${guid}/${file.name}`);
		try {
			const configPath = join(definitionsPath, 'definitions-config.json');
			const configData = await readFile(configPath, 'utf-8');
			const config = JSON.parse(configData);

			if (!config.definitions) {
				config.definitions = {};
			}

			// Find the definition with this GUID by searching through all definitions
			let defKey: string | null = null;
			for (const [key, def] of Object.entries(config.definitions)) {
				if (typeof def === 'object' && def !== null && 'guid' in def && def.guid === guid) {
					defKey = key;
					break;
				}
			}

			if (!defKey) {
				throw new Error(`No definition found with GUID: ${guid}`);
			}

			// Store the relative path to the file (GUID/filename)
			const relativeFilePath = `${guid}/${file.name}`;
			const definition = config.definitions[defKey] as Record<string, unknown>;
			definition.file = relativeFilePath;

			await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
			console.warn(`[Definition Upload] Updated config for ${defKey}, file path: ${relativeFilePath}`);
		} catch (configErr) {
			console.warn('[Definition Upload] Could not update config:', configErr);
			// Don't fail - the file was still written
		}

		return json({
			success: true,
			filename: file.name,
			guid: guid,
			relativePath: `${guid}/${file.name}`
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		console.error('[Definition Upload] Failed to upload definition:', err);
		throw error(500, 'Failed to upload definition');
	}
};
