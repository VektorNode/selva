import * as THREE from 'three';

import {
	MAX_EXTRACT_VERTICES,
	edgeExtractWorkerSource,
	extractEdgeSegments
} from '../edge-extract.js';
import { INLINE_TRIANGLE_BUDGET, SEGMENT_CACHE_BYTE_BUDGET } from './options.js';

// ============================================================================
// Segment extraction — fast path, content cache, worker offload
// ============================================================================

export function triangleCountOf(geometry: THREE.BufferGeometry): number {
	const position = geometry.getAttribute('position');
	if (!position) return 0;
	return (geometry.index ? geometry.index.count : position.count) / 3;
}

interface FastPathData {
	positions: Float32Array;
	index: Uint32Array | Uint16Array | null;
}

/**
 * The fast extractor consumes plain non-interleaved float32 xyz + typed index arrays — which is
 * what every geometry in this pipeline has. Anything exotic (interleaved, float64, morphed) falls
 * back to `THREE.EdgesGeometry`, trading speed for guaranteed-identical semantics.
 */
function fastPathData(geometry: THREE.BufferGeometry): FastPathData | null {
	const position = geometry.getAttribute('position');
	if (
		!position ||
		(position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ||
		position.itemSize !== 3 ||
		!(position.array instanceof Float32Array) ||
		position.count >= MAX_EXTRACT_VERTICES
	) {
		return null;
	}
	const index = geometry.index;
	if (index && !(index.array instanceof Uint32Array) && !(index.array instanceof Uint16Array)) {
		return null;
	}
	return {
		positions: position.array,
		index: index ? (index.array as Uint32Array | Uint16Array) : null
	};
}

/**
 * Content fingerprint for the cross-solve cache: FNV-1a over sampled raw words of the position
 * (and index) arrays plus their lengths and the crease angle. Sampling (head + tail blocks) keeps
 * it ~free even at millions of vertices; two *different* solves colliding would need identical
 * lengths AND identical sampled regions — not a realistic geometry edit.
 */
function contentKey(data: FastPathData, thresholdAngle: number): string {
	const SAMPLE_WORDS = 4096;
	let hash = 0x811c9dc5;
	const mix = (word: number): void => {
		hash ^= word;
		hash = Math.imul(hash, 0x01000193);
	};

	const words = new Uint32Array(
		data.positions.buffer,
		data.positions.byteOffset,
		data.positions.length
	);
	const head = Math.min(SAMPLE_WORDS, words.length);
	for (let i = 0; i < head; i++) mix(words[i]);
	for (let i = Math.max(head, words.length - SAMPLE_WORDS); i < words.length; i++) mix(words[i]);

	let indexLength = 0;
	if (data.index) {
		indexLength = data.index.length;
		const headIndex = Math.min(SAMPLE_WORDS, indexLength);
		for (let i = 0; i < headIndex; i++) mix(data.index[i]);
		for (let i = Math.max(headIndex, indexLength - SAMPLE_WORDS); i < indexLength; i++) {
			mix(data.index[i]);
		}
	}

	return `${thresholdAngle}:${data.positions.length}:${indexLength}:${hash >>> 0}`;
}

/**
 * Cross-solve segment cache. The viewer rebuilds every `BufferGeometry` each solve, so identity
 * caches never hit across solves — this LRU keys on content instead, making "same meshes again"
 * (unchanged inputs, toggling edges, camera-only updates) free. Stores raw segment arrays (CPU
 * only); `LineSegmentsGeometry` uses the array as its backing store without copying, so entries
 * are safely shared across any number of overlays.
 */
const segmentCache = new Map<string, Float32Array>();
let segmentCacheBytes = 0;

function segmentCacheGet(key: string): Float32Array | undefined {
	const cached = segmentCache.get(key);
	if (cached) {
		// Refresh LRU order.
		segmentCache.delete(key);
		segmentCache.set(key, cached);
	}
	return cached;
}

function segmentCachePut(key: string, segments: Float32Array): void {
	if (segments.byteLength > SEGMENT_CACHE_BYTE_BUDGET) return;
	const existing = segmentCache.get(key);
	if (existing) {
		segmentCacheBytes -= existing.byteLength;
		segmentCache.delete(key);
	}
	segmentCache.set(key, segments);
	segmentCacheBytes += segments.byteLength;
	while (segmentCacheBytes > SEGMENT_CACHE_BYTE_BUDGET) {
		const oldestKey = segmentCache.keys().next().value as string;
		segmentCacheBytes -= segmentCache.get(oldestKey)!.byteLength;
		segmentCache.delete(oldestKey);
	}
}

/** Extract via `THREE.EdgesGeometry` — the slow but universally-correct fallback. */
function extractViaThree(geometry: THREE.BufferGeometry, thresholdAngle: number): Float32Array {
	const edges = new THREE.EdgesGeometry(geometry, thresholdAngle);
	const positions = edges.attributes.position
		? (edges.attributes.position.array as Float32Array)
		: new Float32Array(0);
	edges.dispose(); // frees only GPU-side state; the CPU array is the return value
	return positions;
}

/** Synchronous extraction: content cache → fast extractor → EdgesGeometry fallback. */
export function extractSegmentsSync(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number
): Float32Array {
	const data = fastPathData(geometry);
	if (!data) return extractViaThree(geometry, thresholdAngle);

	const key = contentKey(data, thresholdAngle);
	const cached = segmentCacheGet(key);
	if (cached) return cached;

	const segments = extractEdgeSegments(data.positions, data.index, thresholdAngle);
	segmentCachePut(key, segments);
	return segments;
}

// --- Worker offload -----------------------------------------------------------------------------

interface PendingRequest {
	resolve: (segments: Float32Array) => void;
	reject: (error: Error) => void;
}

let extractionWorker: Worker | null | undefined; // undefined = not yet tried, null = unavailable
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;

function getExtractionWorker(): Worker | null {
	if (extractionWorker !== undefined) return extractionWorker;
	if (
		typeof Worker === 'undefined' ||
		typeof Blob === 'undefined' ||
		typeof URL === 'undefined' ||
		typeof URL.createObjectURL !== 'function'
	) {
		extractionWorker = null;
		return null;
	}
	try {
		// Blob URL keeps the library bundler-agnostic (no `new Worker(new URL(...))` magic). The URL
		// is deliberately never revoked: revoking before the worker finishes fetching is
		// unspecified behavior, and one blob URL for a process-lifetime singleton is negligible.
		const url = URL.createObjectURL(
			new Blob([edgeExtractWorkerSource()], { type: 'text/javascript' })
		);
		const worker = new Worker(url);
		worker.onmessage = (event: MessageEvent) => {
			const { id, segments, error } = event.data as {
				id: number;
				segments?: Float32Array;
				error?: string;
			};
			const pending = pendingRequests.get(id);
			if (!pending) return;
			pendingRequests.delete(id);
			if (segments) pending.resolve(segments);
			else pending.reject(new Error(error ?? 'edge extraction failed in worker'));
		};
		worker.onerror = () => {
			// Worker died (CSP, OOM, script error): fail everything in flight — callers fall back to
			// inline extraction — and never try the worker again this session.
			for (const pending of pendingRequests.values()) {
				pending.reject(new Error('edge extraction worker crashed'));
			}
			pendingRequests.clear();
			worker.terminate();
			extractionWorker = null;
		};
		extractionWorker = worker;
	} catch {
		extractionWorker = null;
	}
	return extractionWorker;
}

function extractInWorker(
	worker: Worker,
	data: FastPathData,
	thresholdAngle: number
): Promise<Float32Array> {
	return new Promise<Float32Array>((resolve, reject) => {
		const id = nextRequestId++;
		pendingRequests.set(id, { resolve, reject });
		// Copy before transfer — the originals back the render geometry.
		const positions = data.positions.slice();
		const index = data.index ? data.index.slice() : null;
		const transfer: Transferable[] = [positions.buffer];
		if (index) transfer.push(index.buffer);
		worker.postMessage({ id, positions, index, thresholdAngle }, transfer);
	});
}

/**
 * In-flight dedupe: N meshes with identical content (or repeated applies during one extraction)
 * share one worker round-trip. Keyed by content key; cleared when the request settles (results
 * land in the segment cache, which takes over from there).
 */
const inFlightExtractions = new Map<string, Promise<Float32Array>>();

/** Asynchronous extraction: cache → worker (large fast-path meshes) → inline fallback. */
export function extractSegmentsAsync(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number
): Promise<Float32Array> {
	const data = fastPathData(geometry);
	if (!data || triangleCountOf(geometry) < INLINE_TRIANGLE_BUDGET) {
		return Promise.resolve(extractSegmentsSync(geometry, thresholdAngle));
	}

	const key = contentKey(data, thresholdAngle);
	const cached = segmentCacheGet(key);
	if (cached) return Promise.resolve(cached);

	const inFlight = inFlightExtractions.get(key);
	if (inFlight) return inFlight;

	const worker = getExtractionWorker();
	if (!worker) return Promise.resolve(extractSegmentsSync(geometry, thresholdAngle));

	const request = extractInWorker(worker, data, thresholdAngle)
		.catch(() => extractEdgeSegments(data.positions, data.index, thresholdAngle))
		.then((segments) => {
			segmentCachePut(key, segments);
			return segments;
		})
		.finally(() => {
			inFlightExtractions.delete(key);
		});
	inFlightExtractions.set(key, request);
	return request;
}
