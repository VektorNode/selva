/**
 * Every local store (`auth-users.json`, `compute.config.json`, the definitions
 * doc, …) reads and writes through these two functions, so their edge cases are
 * everyone's edge cases.
 *
 * Two properties carry real weight:
 *   - **`writeJsonFile` is crash-safe.** It writes a sibling `.tmp` and renames.
 *     `rename` is atomic within a filesystem, so a crash leaves either the old
 *     file or the new one — never a half-written doc.
 *   - **`readJsonFile` swallows only ENOENT.** Any other error (permissions, a
 *     directory in the way, corrupt JSON) must propagate rather than
 *     masquerade as "empty" — returning the fallback there would present a
 *     live store as blank and invite the next write to overwrite real data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

/**
 * The two rename-under-contention tests below assert POSIX semantics: `rename`
 * atomically replaces the destination even while a reader holds it open.
 * Windows refuses instead — EPERM if any other handle is on the target, and an
 * antivirus/indexer touching the fresh `.tmp` is enough to trip it. That's a
 * platform difference in the assertion, not a defect in `writeJsonFile`,
 * whose per-writer UUID temp is correct on both. CI runs ubuntu-latest, so
 * skipping here doesn't lose coverage — it just keeps local Windows runs
 * from going permanently red.
 */
const posixRename = it.skipIf(process.platform === 'win32');

let dir: string;
let file: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'selva-fsjson-'));
	file = path.join(dir, 'doc.json');
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('readJsonFile', () => {
	it('round-trips what writeJsonFile wrote', async () => {
		await writeJsonFile(file, { hello: 'world', n: 42, nested: { a: [1, 2, 3] } });
		expect(await readJsonFile(file, null)).toEqual({
			hello: 'world',
			n: 42,
			nested: { a: [1, 2, 3] }
		});
	});

	it('returns the fallback for a missing file (the empty-store case)', async () => {
		const fallback = { servers: [] };
		expect(await readJsonFile(path.join(dir, 'nope.json'), fallback)).toBe(fallback);
	});

	it('returns the fallback BY REFERENCE — callers must not share one instance', async () => {
		// Local stores guard against this by passing a fresh `empty()` per call —
		// a shared fallback would leak mutations across reads, and across stores.
		const fallback = { servers: [] as string[] };
		const first = await readJsonFile(path.join(dir, 'nope.json'), fallback);
		first.servers.push('mutated');

		const second = await readJsonFile(path.join(dir, 'nope.json'), fallback);
		expect(second.servers).toEqual(['mutated']);
		expect(second).toBe(first);
	});

	it('propagates malformed JSON instead of hiding it as empty', async () => {
		await fs.writeFile(file, '{"servers": [', 'utf-8');
		await expect(readJsonFile(file, { servers: [] })).rejects.toThrow();
	});

	it('propagates a non-ENOENT fs error (directory where a file is expected)', async () => {
		const asDir = path.join(dir, 'imadir.json');
		await fs.mkdir(asDir);
		// EISDIR (or EPERM on some platforms), not ENOENT — must not be swallowed as "missing".
		await expect(readJsonFile(asDir, { fallback: true })).rejects.toThrow();
	});
});

describe('writeJsonFile', () => {
	it('creates missing parent directories', async () => {
		const deep = path.join(dir, 'a', 'b', 'c', 'doc.json');
		await writeJsonFile(deep, { ok: true });
		expect(await readJsonFile(deep, null)).toEqual({ ok: true });
	});

	it('overwrites an existing file', async () => {
		await writeJsonFile(file, { v: 1 });
		await writeJsonFile(file, { v: 2 });
		expect(await readJsonFile(file, null)).toEqual({ v: 2 });
	});

	it('leaves no .tmp file behind on success', async () => {
		await writeJsonFile(file, { ok: true });
		expect(await fs.readdir(dir)).toEqual(['doc.json']);
	});

	posixRename(
		'never exposes a partially-written target, even for a payload far past one page',
		async () => {
			// A direct writeFile to the target could expose a partial write for a
			// payload large enough to be flushed in chunks; tmp+rename holds
			// regardless of size because rename is atomic within a filesystem.
			await writeJsonFile(file, { generation: 1, blob: 'x'.repeat(2_000_000) });

			// Race a reader against the writer. Every observation must be a valid
			// document — generation 1 or 2, never a truncated mix.
			const write = writeJsonFile(file, { generation: 2, blob: 'y'.repeat(2_000_000) });
			const seen: number[] = [];
			for (let i = 0; i < 40; i++) {
				const doc = await readJsonFile<{ generation: number } | null>(file, null);
				if (doc) seen.push(doc.generation);
			}
			await write;

			// Never a torn/unparseable read, and generation 1 or 2 only — no mix.
			expect(seen.length).toBeGreaterThan(0);
			expect(seen.every((g) => g === 1 || g === 2)).toBe(true);
			expect(await readJsonFile<{ generation: number }>(file, { generation: 0 })).toMatchObject({
				generation: 2
			});
			expect(await fs.readdir(dir)).toEqual(['doc.json']);
		}
	);

	it('serializes with tab indent (stable on-disk diffs)', async () => {
		await writeJsonFile(file, { a: 1 });
		expect(await fs.readFile(file, 'utf-8')).toBe('{\n\t"a": 1\n}');
	});

	posixRename('survives concurrent writes to the same target (no shared temp file)', async () => {
		// REGRESSION: the temp file used to be a fixed `${filePath}.tmp`, shared
		// by every concurrent writer. The first rename moved it away and every
		// other writer then died with ENOENT renaming a file that no longer
		// existed — overlapping writes didn't just race, they threw. Each writer
		// now uses its own temp name.
		const writes = Array.from({ length: 20 }, (_, i) => writeJsonFile(file, { writer: i }));
		const settled = await Promise.allSettled(writes);

		expect(settled.filter((r) => r.status === 'rejected')).toEqual([]);
		const final = await readJsonFile<{ writer: number }>(file, { writer: -1 });
		expect(final.writer).toBeGreaterThanOrEqual(0);
		expect(await fs.readdir(dir)).toEqual(['doc.json']);
	});
});

/**
 * SEL-4. This helper is the sole writer for `auth-users.json` (email addresses
 * + PBKDF2 password hashes), so a default-umask 0644 lets any other local user
 * or co-tenant service on the host copy the hashes and crack them offline.
 * Windows has no POSIX mode bits, so the assertion is POSIX-only — the write
 * itself is correct on both.
 */
const posixMode = it.skipIf(process.platform === 'win32');

describe('writeJsonFile permissions', () => {
	posixMode('writes the file owner-only (0600)', async () => {
		await writeJsonFile(file, { secret: true });
		const { mode } = await fs.stat(file);
		expect(mode & 0o777).toBe(0o600);
	});

	posixMode('creates a missing parent directory owner-only (0700)', async () => {
		const nested = path.join(dir, 'sub', 'doc.json');
		await writeJsonFile(nested, { secret: true });
		const { mode } = await fs.stat(path.dirname(nested));
		expect(mode & 0o777).toBe(0o700);
	});

	posixMode('leaves no readable temp file behind', async () => {
		await writeJsonFile(file, { secret: true });
		expect((await fs.readdir(dir)).filter((n) => n.endsWith('.tmp'))).toEqual([]);
	});
});
