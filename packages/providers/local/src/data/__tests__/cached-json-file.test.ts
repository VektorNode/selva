import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CachedJsonFile } from '../fsJson.js';

interface Doc {
	value: number;
}

let dir: string;
let file: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-cached-json-'));
	file = path.join(dir, 'doc.json');
});

afterEach(async () => {
	vi.restoreAllMocks();
	await fs.rm(dir, { recursive: true, force: true });
});

const open = () => new CachedJsonFile<Doc>(file, () => ({ value: 0 }));

describe('CachedJsonFile', () => {
	it('serves what is on disk after a failed write', async () => {
		const doc = open();
		const value = await doc.get();
		value.value = 1;
		await doc.write(value);

		// A directory at the temp path's parent makes the write fail, as a full disk would.
		await fs.rm(dir, { recursive: true, force: true });
		await fs.writeFile(dir, 'not a directory');
		const stale = await doc.get();
		stale.value = 2;
		await expect(doc.write(stale)).rejects.toThrow();
		await fs.rm(dir);
		await fs.mkdir(dir);
		await fs.writeFile(file, JSON.stringify({ value: 1 }));

		expect((await doc.get()).value).toBe(1);
	});

	it('recovers once a file that failed to parse is repaired', async () => {
		await fs.writeFile(file, '{ broken');
		const doc = open();
		await expect(doc.get()).rejects.toThrow();

		await fs.writeFile(file, JSON.stringify({ value: 7 }));

		expect((await doc.get()).value).toBe(7);
	});

	it('lets the newest state win overlapping writes', async () => {
		const doc = open();
		const value = await doc.get();
		const writes: Promise<void>[] = [];
		for (let i = 1; i <= 50; i++) {
			value.value = i;
			writes.push(doc.write(value));
		}
		await Promise.all(writes);

		expect(JSON.parse(await fs.readFile(file, 'utf8')).value).toBe(50);
	});
});
