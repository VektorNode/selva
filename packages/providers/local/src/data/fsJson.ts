import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Returns `fallback` if the file doesn't exist. Other errors propagate. */
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
 * Writes to a sibling temp file, then renames into place, so a crash mid-write
 * can't corrupt the target. The temp name is random per call — a fixed `.tmp`
 * name broke concurrent writers: the first rename moved the shared temp away,
 * and every other writer then failed with ENOENT renaming a file that no
 * longer existed. With a random name each writer renames its own file; last
 * rename wins, same as the last-write-wins the read-modify-write callers
 * already have.
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	const tmp = `${filePath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), 'utf-8');
		await fs.rename(tmp, filePath);
	} catch (err) {
		await fs.rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
}
