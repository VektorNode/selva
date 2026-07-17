/**
 * Audit Q5.4 — direct tests for the local provider's JSON persistence primitive.
 *
 * Every local store (`auth-users.json`, `compute.config.json`, the definitions
 * doc, …) reads and writes through these two functions, so their edge cases are
 * everyone's edge cases. They were previously covered only obliquely — via
 * `empty-fallback-isolation.test.ts`, which exercises the aliasing hazard through
 * `LocalInviteStore` rather than naming it.
 *
 * Two properties carry real weight:
 *   - **`writeJsonFile` is crash-safe.** It writes a sibling `.tmp` and renames.
 *     `rename` is atomic within a filesystem, so a crash leaves either the old
 *     file or the new one — never a half-written doc. Losing this would corrupt
 *     the whole store on an ill-timed kill.
 *   - **`readJsonFile` swallows only ENOENT.** A missing file is a legitimate
 *     empty state; any other error (permissions, a directory in the way, corrupt
 *     JSON) must propagate rather than masquerade as "empty" — silently
 *     returning the fallback there would present a live store as blank and
 *     invite the next write to overwrite real data.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { readJsonFile, writeJsonFile } from '../fsJson.js';

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
		// This is the aliasing hazard the local stores guard against with a
		// fresh `empty()` per call. Pinned here at the source so the behavior is
		// documented where it originates, not just where it bites: a mutated
		// fallback would leak across reads, and across stores.
		const fallback = { servers: [] as string[] };
		const first = await readJsonFile(path.join(dir, 'nope.json'), fallback);
		first.servers.push('mutated');

		const second = await readJsonFile(path.join(dir, 'nope.json'), fallback);
		expect(second.servers).toEqual(['mutated']);
		expect(second).toBe(first);
	});

	it('propagates malformed JSON instead of hiding it as empty', async () => {
		// A truncated/corrupt doc is NOT an empty store. Returning the fallback
		// would present live data as blank — and the next write would flatten it.
		await fs.writeFile(file, '{"servers": [', 'utf-8');
		await expect(readJsonFile(file, { servers: [] })).rejects.toThrow();
	});

	it('propagates a non-ENOENT fs error (directory where a file is expected)', async () => {
		const asDir = path.join(dir, 'imadir.json');
		await fs.mkdir(asDir);
		// EISDIR (or EPERM on some platforms) — must not be swallowed as "missing".
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
		// The temp file is renamed, not copied — a leftover would accumulate one
		// stray file per write, and hint the rename never happened.
		expect(await fs.readdir(dir)).toEqual(['doc.json']);
	});

	it('never exposes a partially-written target, even for a payload far past one page', async () => {
		// The crash-safety claim in one property: at NO point during a write does
		// `doc.json` hold anything but a complete, parseable document. A direct
		// `writeFile` to the target would break this for any payload large enough
		// to be flushed in chunks; tmp+rename holds regardless of size because
		// rename is atomic within a filesystem.
		await writeJsonFile(file, { generation: 1, blob: 'x'.repeat(2_000_000) });

		// Race a reader against the writer. Every observation must be a valid
		// document — generation 1 or 2, never a truncated mix.
		const write = writeJsonFile(file, { generation: 2, blob: 'y'.repeat(2_000_000) });
		const seen: number[] = [];
		for (let i = 0; i < 40; i++) {
			// Reads that lose the race to the rename see ENOENT-free old content;
			// a parse failure here would mean a torn file.
			const doc = await readJsonFile<{ generation: number } | null>(file, null);
			if (doc) seen.push(doc.generation);
		}
		await write;

		expect(seen.length).toBeGreaterThan(0);
		expect(seen.every((g) => g === 1 || g === 2)).toBe(true);
		expect(await readJsonFile<{ generation: number }>(file, { generation: 0 })).toMatchObject({
			generation: 2
		});
		expect(await fs.readdir(dir)).toEqual(['doc.json']);
	});

	it('serializes with tab indent (stable on-disk diffs)', async () => {
		await writeJsonFile(file, { a: 1 });
		expect(await fs.readFile(file, 'utf-8')).toBe('{\n\t"a": 1\n}');
	});

	it('survives concurrent writes to the same target (no shared temp file)', async () => {
		// REGRESSION (audit Q5.2): the temp file used to be a fixed
		// `${filePath}.tmp`, shared by every concurrent writer. The first rename
		// moved it away and every other writer then died with ENOENT renaming a
		// file that no longer existed — so overlapping writes didn't merely
		// race, they THREW. 19 of 20 concurrent share-link solve increments
		// failed this way. Each writer now uses its own temp name.
		const writes = Array.from({ length: 20 }, (_, i) => writeJsonFile(file, { writer: i }));
		const settled = await Promise.allSettled(writes);

		expect(settled.filter((r) => r.status === 'rejected')).toEqual([]);
		// Last write wins, and the result is always a complete document.
		const final = await readJsonFile<{ writer: number }>(file, { writer: -1 });
		expect(final.writer).toBeGreaterThanOrEqual(0);
		// No temp files survive the storm.
		expect(await fs.readdir(dir)).toEqual(['doc.json']);
	});
});
