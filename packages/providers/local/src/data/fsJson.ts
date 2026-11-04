import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

const fileQueues = new Map<string, Promise<unknown>>();

/**
 * Runs a read-modify-write of `filePath` alone in this process, so two writers
 * can't both start from the same snapshot and lose one's change.
 */
export function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
	// Chain onto the tail however the previous write settled, so one rejection
	// can't wedge the queue.
	const next = (fileQueues.get(filePath) ?? Promise.resolve()).then(fn, fn);
	const tail = next.catch(() => {});
	fileQueues.set(filePath, tail);
	void tail.then(() => {
		if (fileQueues.get(filePath) === tail) fileQueues.delete(filePath);
	});
	return next;
}

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
 * can't corrupt the target. The temp name is random per call: a shared name would
 * let one writer's rename pull the file out from under another. A read-modify-write
 * caller still needs {@link withFileLock}.
 *
 * Owner-only permissions are not optional here: this helper is the sole writer
 * for `auth-users.json` (email addresses + PBKDF2 password hashes) and
 * `compute.config.json`. Under a default umask those land 0644, and any other
 * local user or co-tenant service on the host can copy the hashes and crack
 * them offline. The mode goes on the temp file, not the target — `rename`
 * keeps the temp file's bits, so a post-rename `chmod` would leave a readable
 * window. No-op on Windows.
 */
export async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
	await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
	const tmp = `${filePath}.${randomUUID()}.tmp`;
	try {
		await fs.writeFile(tmp, JSON.stringify(data, null, '\t'), { encoding: 'utf-8', mode: 0o600 });
		await fs.rename(tmp, filePath);
	} catch (err) {
		await fs.rm(tmp, { force: true }).catch(() => {});
		throw err;
	}
}

/**
 * A JSON file read once and kept in memory, where the provider is the sole writer
 * in a single process. Callers mutate what `get` returns, then pass it to `write`.
 */
export class CachedJsonFile<T> {
	private cache: T | null = null;
	private loading: Promise<T> | null = null;

	constructor(
		readonly filePath: string,
		private readonly fallback: () => T
	) {}

	/** Concurrent first callers share one read, so they mutate the same object. */
	async get(): Promise<T> {
		if (this.cache) return this.cache;
		this.loading ??= readJsonFile<T>(this.filePath, this.fallback())
			.then((data) => {
				this.cache = data;
				return data;
			})
			.finally(() => {
				this.loading = null;
			});
		return this.loading;
	}

	/**
	 * Writes run one at a time and stringify when their turn comes, so the newest
	 * state lands last. A failed write drops the cache: it holds a change the disk
	 * never took.
	 */
	async write(data: T): Promise<void> {
		this.cache = data;
		try {
			await withFileLock(this.filePath, () => writeJsonFile(this.filePath, data));
		} catch (err) {
			this.cache = null;
			throw err;
		}
	}
}
