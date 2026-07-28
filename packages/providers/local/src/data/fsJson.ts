import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

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
 * sibling temp file, then rename into place. Prevents partial writes from
 * corrupting the target on crash or interrupt.
 *
 * The temp name carries a random suffix so concurrent writers to the same
 * target never share it. A fixed `.tmp` made overlapping writes destroy each
 * other — the first `rename` moved the shared temp away and every other writer
 * then failed with ENOENT renaming a file that no longer existed. Each writer
 * now renames its own file; last rename wins, which is the same last-write-wins
 * the read-modify-write callers already have.
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
		await fs.rename(tmp, filePath);
	} catch (err) {
		// Don't leave the temp behind if the write or rename failed.
		await fs.rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
}
