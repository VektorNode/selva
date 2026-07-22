import * as THREE from 'three';

import { CACHED_GEOMETRY_USERDATA_FLAG } from '../threejs/three-helpers.js';

/**
 * Cross-solve `BufferGeometry` cache, keyed by geometry *content* (audit P1 —
 * docs/plans/5.display-pipeline-performance-audit.md).
 *
 * The viewer rebuilds the whole scene every solve: `clearScene` disposes every geometry and the
 * parser re-decodes, re-copies, re-computes normals and re-uploads to the GPU — even for meshes the
 * solve didn't change. This cache closes that loop the same way the edge-segment cache does:
 * fingerprint the *raw wire windows* a geometry is built from, and on a hit hand back the very same
 * `BufferGeometry` (normals computed, GPU buffers still resident) instead of rebuilding it.
 *
 * Safety model:
 * - Cached geometries are tagged with {@link CACHED_GEOMETRY_USERDATA_FLAG}; `clearScene` skips
 *   disposing them, so the GPU buffers survive scene rebuilds. Everything else is disposed exactly
 *   as before.
 * - Eviction (LRU by vertex+index bytes) *does* dispose. If an evicted geometry is still attached
 *   to a live mesh, three transparently re-uploads its buffers on the next render — a one-frame
 *   cost, never corruption.
 * - Sharing one geometry across several meshes (same content appearing twice in a solve, or across
 *   solves) is safe: geometry is immutable after build, and materials live on the meshes.
 */

/** CPU+GPU byte budget for cached geometry (positions+normals+indices+uv+color attributes). */
const GEOMETRY_CACHE_BYTE_BUDGET = 256 * 1024 * 1024;

/** Words sampled from the head and tail of each buffer window when fingerprinting. */
const SAMPLE_WORDS = 1024;

interface CacheEntry {
	geometry: THREE.BufferGeometry;
	bytes: number;
}

const cache = new Map<string, CacheEntry>();
let cacheBytes = 0;

/**
 * FNV-1a over head+tail samples of each part plus every part's exact length, mixed with a caller
 * salt (quantization origin/scale, flags, window layout). Sampling keeps the hash ~free at millions
 * of vertices; a false hit would need identical lengths AND identical sampled regions across a real
 * geometry edit — the same accepted trade the edge-segment cache documents.
 */
export function fingerprintViews(parts: (ArrayBufferView | null)[], salt: string): string {
	let hash = 0x811c9dc5;
	const mix = (word: number): void => {
		hash ^= word;
		hash = Math.imul(hash, 0x01000193);
	};

	for (let i = 0; i < salt.length; i++) mix(salt.charCodeAt(i));

	for (const part of parts) {
		if (!part) {
			mix(0xdead);
			continue;
		}
		// Hash raw 32-bit words where alignment allows; fall back to a byte view otherwise.
		const byteLength = part.byteLength;
		mix(byteLength);
		if ((part.byteOffset & 3) === 0 && (byteLength & 3) === 0) {
			const words = new Uint32Array(part.buffer, part.byteOffset, byteLength >> 2);
			const head = Math.min(SAMPLE_WORDS, words.length);
			for (let i = 0; i < head; i++) mix(words[i]!);
			for (let i = Math.max(head, words.length - SAMPLE_WORDS); i < words.length; i++) {
				mix(words[i]!);
			}
		} else {
			const bytes = new Uint8Array(part.buffer, part.byteOffset, byteLength);
			const head = Math.min(SAMPLE_WORDS * 4, bytes.length);
			for (let i = 0; i < head; i++) mix(bytes[i]!);
			for (let i = Math.max(head, bytes.length - SAMPLE_WORDS * 4); i < bytes.length; i++) {
				mix(bytes[i]!);
			}
		}
	}

	return `${(hash >>> 0).toString(36)}:${parts.length}`;
}

function bytesOf(geometry: THREE.BufferGeometry): number {
	let total = geometry.index?.array.byteLength ?? 0;
	for (const attribute of Object.values(geometry.attributes)) {
		total += (attribute as THREE.BufferAttribute).array.byteLength;
	}
	return total;
}

/** Look up a cached geometry, refreshing its LRU position. */
export function geometryCacheGet(key: string): THREE.BufferGeometry | undefined {
	const entry = cache.get(key);
	if (!entry) return undefined;
	cache.delete(key);
	cache.set(key, entry);
	return entry.geometry;
}

/** Insert a freshly built geometry, tagging it so `clearScene` won't dispose it. */
export function geometryCachePut(key: string, geometry: THREE.BufferGeometry): void {
	const bytes = bytesOf(geometry);
	if (bytes > GEOMETRY_CACHE_BYTE_BUDGET) return; // absurd single geometry — don't cache

	geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG] = true;

	const existing = cache.get(key);
	if (existing) {
		// Same content raced in twice (e.g. duplicate content within one solve building in
		// parallel) — keep the incumbent, dispose nothing: the caller uses the returned geometry.
		return;
	}

	cache.set(key, { geometry, bytes });
	cacheBytes += bytes;

	while (cacheBytes > GEOMETRY_CACHE_BYTE_BUDGET && cache.size > 1) {
		const oldestKey = cache.keys().next().value as string;
		const oldest = cache.get(oldestKey)!;
		cache.delete(oldestKey);
		cacheBytes -= oldest.bytes;
		// Disposing while still referenced by a scene mesh is safe: three re-uploads on next render.
		// Clear the tag so a later clearScene can dispose it for good.
		delete oldest.geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG];
		oldest.geometry.dispose();
	}
}

/** Test/diagnostic hook: empty the cache, disposing everything in it. */
export function geometryCacheClear(): void {
	for (const entry of cache.values()) {
		delete entry.geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG];
		entry.geometry.dispose();
	}
	cache.clear();
	cacheBytes = 0;
}
