import type * as THREE from 'three';

import { shareGeometry, unshareGeometry } from '../../../shared/index.js';
import { geometryFrom } from './merge.js';

import type { AssemblyJob, FinishedGeometry } from '../mesh-assembly.js';

/**
 * Finished geometries from earlier batches, keyed by the exact geometry chunk bytes and the jobs cut
 * from them. A re-solve that only changed materials, names or layers sends the same geometry bytes,
 * and a hit skips inflate, decode, the closed-solid test and the crease split: most of a parse.
 *
 * A hit is decided by comparing every byte, never by a fingerprint alone: a sampled fingerprint can
 * match two different payloads and serve stale geometry without an error.
 *
 * A hit hands out the same `BufferGeometry` objects again, registered with `shareGeometry`. Who frees
 * what is the cache rule in `shared/gpu-ownership.ts`.
 */

export interface FinishedBatch {
	geometries: FinishedGeometry[];
	hasUvs: boolean;
	hasColors: boolean;
	vertexCount: number;
	indexCount: number;
}

/** One `BufferGeometry` per job, in job order, with each job's closed-solid flag. */
export interface BuiltBatch extends Omit<FinishedBatch, 'geometries'> {
	buffers: THREE.BufferGeometry[];
	closed: boolean[];
}

interface Entry extends BuiltBatch {
	geometryBytes: Uint8Array;
	jobShape: Int32Array;
	bytes: number;
}

// A colour change on a 2M-vertex scene keeps ~110 MB of finished arrays; this holds two variants.
const MAX_BYTES = 256 * 1024 * 1024;

const entries = new Map<string, Entry>();
let totalBytes = 0;

export function getFinishedBatch(
	geometryBytes: Uint8Array,
	jobs: AssemblyJob[]
): BuiltBatch | null {
	const jobShape = shapeOf(jobs);
	const key = cacheKey(geometryBytes, jobShape);
	const entry = entries.get(key);
	if (
		!entry ||
		!sameInts(entry.jobShape, jobShape) ||
		!sameBytes(entry.geometryBytes, geometryBytes)
	)
		return null;
	// Re-insert: Map iteration order is the eviction order.
	entries.delete(key);
	entries.set(key, entry);
	return entry;
}

/** Wraps each finished geometry in a `BufferGeometry`, owned by the scene. */
export function buildBatch(batch: FinishedBatch): BuiltBatch {
	const { geometries, ...rest } = batch;
	return {
		...rest,
		buffers: geometries.map(geometryFrom),
		closed: geometries.map((g) => g.closed)
	};
}

/** Same as {@link buildBatch}, but the cache keeps the geometries for the next identical payload. */
export function storeFinishedBatch(
	geometryBytes: Uint8Array,
	jobs: AssemblyJob[],
	batch: FinishedBatch
): BuiltBatch {
	const built = buildBatch(batch);
	let bytes = geometryBytes.byteLength;
	for (const g of batch.geometries) {
		bytes += g.positions.byteLength + g.normals.byteLength + g.indices.byteLength;
		bytes += (g.uvs?.byteLength ?? 0) + (g.colors?.byteLength ?? 0) + (g.tangents?.byteLength ?? 0);
	}
	if (bytes > MAX_BYTES) return built;

	const jobShape = shapeOf(jobs);
	const key = cacheKey(geometryBytes, jobShape);
	const existing = entries.get(key);
	if (existing) {
		entries.delete(key);
		release(existing);
	}
	built.buffers.forEach(shareGeometry);
	// A copy, so the entry neither pins the whole WebSocket frame nor sees it reused.
	entries.set(key, { ...built, geometryBytes: geometryBytes.slice(), jobShape, bytes });
	totalBytes += bytes;

	for (const [oldest, entry] of entries) {
		if (totalBytes <= MAX_BYTES) break;
		entries.delete(oldest);
		release(entry);
	}
	return built;
}

/**
 * Empties the cache and frees its geometries. The cache lives as long as the page, so a host calls
 * this when its viewer goes away; a mesh still drawing one of them uploads it again.
 */
export function clearGeometryCache(): void {
	entries.forEach(release);
	entries.clear();
}

// A mesh still drawing an evicted geometry is fine: three uploads it again on the next frame.
function release(entry: Entry): void {
	totalBytes -= entry.bytes;
	for (const buffer of entry.buffers) {
		unshareGeometry(buffer);
		buffer.dispose();
	}
}

// Per job: kind, window count, then each window's four numbers. The count prefix keeps two
// different job lists from flattening to the same ints.
function shapeOf(jobs: AssemblyJob[]): Int32Array {
	let length = 0;
	for (const job of jobs) length += 2 + 4 * job.windows.length;
	const shape = new Int32Array(length);
	let i = 0;
	for (const job of jobs) {
		shape[i++] = job.kind === 'merged' ? 1 : 0;
		shape[i++] = job.windows.length;
		for (const w of job.windows) {
			shape[i++] = w.vertexStart;
			shape[i++] = w.vertexCount;
			shape[i++] = w.indexStart;
			shape[i++] = w.indexCount;
		}
	}
	return shape;
}

// Buckets entries; `sameInts` and `sameBytes` decide a hit. 1024 sampled bytes keep this cheap on a
// multi-MB chunk.
function cacheKey(geometryBytes: Uint8Array, jobShape: Int32Array): string {
	const length = geometryBytes.length;
	const stride = Math.max(1, Math.floor(length / 1024));
	let hash = 0x811c9dc5;
	for (let i = 0; i < length; i += stride) {
		hash = Math.imul(hash ^ geometryBytes[i]!, 0x01000193);
	}
	let shapeHash = 0x811c9dc5;
	for (let i = 0; i < jobShape.length; i++) {
		shapeHash = Math.imul(shapeHash ^ jobShape[i]!, 0x01000193);
	}
	return `${length}:${hash >>> 0}:${jobShape.length}:${shapeHash >>> 0}`;
}

function sameInts(a: Int32Array, b: Int32Array): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let i = 0;
	if (a.byteOffset % 4 === 0 && b.byteOffset % 4 === 0) {
		const words = a.length >>> 2;
		const wa = new Uint32Array(a.buffer, a.byteOffset, words);
		const wb = new Uint32Array(b.buffer, b.byteOffset, words);
		for (; i < words; i++) if (wa[i] !== wb[i]) return false;
		i = words << 2;
	}
	for (; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}
