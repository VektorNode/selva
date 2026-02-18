import { json, error } from '@sveltejs/kit';
import { readdir, unlink, writeFile, readFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

const GH_EXTENSIONS = ['.gh', '.ghx'];

// POST - Replace the GH file for an existing definition (upload to GUID folder, archive old)
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

		const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
		if (!GH_EXTENSIONS.includes(extension)) {
			throw error(400, `File type not allowed. Allowed: ${GH_EXTENSIONS.join(', ')}`);
		}

		const arrayBuffer = await file.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const guidFolderPath = join(definitionsPath, guid);
		const oldFilesFolderPath = join(guidFolderPath, 'old_files');
		const newFilePath = join(guidFolderPath, file.name);

		// Ensure GUID folder exists
		await mkdir(guidFolderPath, { recursive: true });

		// Archive any existing GH file that differs from the new one
		try {
			const filesInFolder = await readdir(guidFolderPath);
			for (const fileName of filesInFolder) {
				const fileExt = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
				if (
					fileName !== 'old_files' &&
					GH_EXTENSIONS.includes(fileExt) &&
					join(guidFolderPath, fileName) !== newFilePath
				) {
					// Back up old file: timestamp prefix + original name
					await mkdir(oldFilesFolderPath, { recursive: true });
					const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
					const backupFileName = `${timestamp}_${fileName}`;
					const oldData = await readFile(join(guidFolderPath, fileName));
					await writeFile(join(oldFilesFolderPath, backupFileName), oldData);
					await unlink(join(guidFolderPath, fileName));
					console.warn(`[Upload] Archived old file as: old_files/${backupFileName}`);
					break;
				}
			}
		} catch (archiveErr) {
			console.warn('[Upload] Could not archive old file:', archiveErr);
			// Continue – the new file will still be written
		}

		// Write new file
		await writeFile(newFilePath, buffer);

		// Update config: GUID is the key directly, set `file` to just the filename
		try {
			const configPath = join(definitionsPath, 'definitions-config.json');
			const configData = await readFile(configPath, 'utf-8');
			const config = JSON.parse(configData);

			if (!config.definitions?.[guid]) {
				throw new Error(`Definition with GUID '${guid}' not found in config`);
			}

			config.definitions[guid].file = file.name;
			await writeFile(configPath, JSON.stringify(config, null, '\t'), 'utf-8');
		} catch (configErr) {
			console.warn('[Upload] Could not update config file field:', configErr);
			// Don't fail – the file was written successfully
		}

		return json({ success: true, filename: file.name, guid });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Upload] Failed:', err);
		throw error(500, 'Failed to upload definition file');
	}
};

