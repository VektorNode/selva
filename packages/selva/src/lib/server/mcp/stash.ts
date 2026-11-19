import { randomBytes } from 'node:crypto';
import type { IStorageProvider } from '@selvajs/platform';

/**
 * What an MCP tool hands out by token instead of inline: a solve's output files (a download
 * link), its geometry (for the 3D view) and a rendered preview (for the cover). Kept in the
 * storage provider for {@link STASH_TTL_MS}, so a link survives a restart and works on every
 * instance that shares the storage.
 *
 * A token is the only credential: whoever holds a file link can download it until it expires.
 */
export interface StashEntry {
	kind: 'file' | 'solve' | 'preview';
	/** File name for a download. */
	name: string;
	contentType: string;
	data: Uint8Array;
	expiresAt: number;
}

export interface Stash {
	put(entry: Omit<StashEntry, 'expiresAt'>): Promise<string>;
	/** The entry, if it exists, has not expired and is of `kind`. */
	get(token: string, kind: StashEntry['kind']): Promise<StashEntry | undefined>;
	/** Deletes every hour that holds only expired entries. Cheap when nothing is due. */
	sweep(): Promise<void>;
}

export const STASH_TTL_MS = 60 * 60_000;
export const STASH_SWEEP_EVERY_MS = 60 * 60_000;
// Entries live under the hour they were made in. Storage can't list, so expired entries go by
// deleting whole hours: an hour two behind the current one holds nothing still valid. The last
// hour swept is kept in storage, so a restart, however long, resumes where the last run stopped.
const HOUR_MS = 60 * 60_000;
const SWEEP_BACK_HOURS = 48;
const ROOT = 'mcp-stash';
const SWEPT_MARKER = `${ROOT}/swept.bin`;
const TOKEN = /^(\d+)-([A-Za-z0-9_-]{32})$/;

type Storage = Pick<IStorageProvider, 'get' | 'put' | 'deletePrefix'>;

interface Meta {
	kind: StashEntry['kind'];
	name: string;
	contentType: string;
	expiresAt: number;
}

export function createStash(storage: Storage, now: () => number = Date.now): Stash {
	let sweptThrough: number | undefined;
	let sweeping: Promise<void> | undefined;

	// `.bin` and an octet-stream type, so no provider takes either for an image to transcode.
	const paths = (hour: string, id: string) => ({
		data: `${ROOT}/${hour}/${id}.bin`,
		meta: `${ROOT}/${hour}/${id}.meta.bin`
	});

	async function readMarker(): Promise<number | undefined> {
		const raw = await storage.get(SWEPT_MARKER).catch(() => null);
		const hour = raw ? Number(new TextDecoder().decode(raw)) : NaN;
		return Number.isInteger(hour) ? hour : undefined;
	}

	async function sweepDue(): Promise<void> {
		const last = Math.floor(now() / HOUR_MS) - 2;
		sweptThrough ??= await readMarker();
		if (sweptThrough !== undefined && sweptThrough >= last) return;
		const first = sweptThrough === undefined ? last - SWEEP_BACK_HOURS : sweptThrough + 1;
		for (let hour = first; hour <= last; hour++) {
			await storage.deletePrefix(`${ROOT}/${hour}/`);
		}
		sweptThrough = last;
		await storage.put(
			SWEPT_MARKER,
			new TextEncoder().encode(String(last)),
			'application/octet-stream'
		);
	}

	// Sweeps run one after another, never side by side. A failed one leaves the marker where it
	// was, so the next retries the same hours.
	function sweep(): Promise<void> {
		const run = (sweeping ?? Promise.resolve()).then(sweepDue).catch(() => {});
		sweeping = run;
		return run;
	}

	return {
		sweep,

		async put({ kind, name, contentType, data }) {
			void sweep();
			const hour = String(Math.floor(now() / HOUR_MS));
			const id = randomBytes(24).toString('base64url');
			const at = paths(hour, id);
			const meta: Meta = { kind, name, contentType, expiresAt: now() + STASH_TTL_MS };
			await storage.put(at.data, data, 'application/octet-stream');
			await storage.put(
				at.meta,
				new TextEncoder().encode(JSON.stringify(meta)),
				'application/octet-stream'
			);
			return `${hour}-${id}`;
		},

		async get(token, kind) {
			void sweep();
			const match = TOKEN.exec(token);
			if (!match) return undefined;
			const at = paths(match[1], match[2]);
			const rawMeta = await storage.get(at.meta);
			if (!rawMeta) return undefined;
			const meta = JSON.parse(new TextDecoder().decode(rawMeta)) as Meta;
			if (meta.kind !== kind || meta.expiresAt <= now()) return undefined;
			const data = await storage.get(at.data);
			return data ? { ...meta, data } : undefined;
		}
	};
}

/** For a solve's geometry: the stash holds bytes. */
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
export const fromJsonBytes = (bytes: Uint8Array): unknown =>
	JSON.parse(new TextDecoder().decode(bytes));
