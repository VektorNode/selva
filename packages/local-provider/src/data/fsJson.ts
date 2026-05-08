import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/**
 * Read a JSON file, returning a fallback if the file does not exist.
 * Any other error propagates.
 */
export async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
	try {
		const raw = await fs.readFile(filePath, 'utf-8');
		return JSON.parse(raw) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
		throw err;
	}
}

/**
 * Atomically write JSON: ensure the parent directory exists, write to a
 * sibling .tmp file, then rename into place. Prevents partial writes from
 * corrupting the target on crash or interrupt.
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
	await fs.rename(tmp, filePath);
}
