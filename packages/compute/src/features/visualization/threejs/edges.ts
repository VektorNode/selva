import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { MAX_EXTRACT_VERTICES, edgeExtractWorkerSource, extractEdgeSegments } from './edge-extract';

/**
 * Crisp boundary/crease edges overlaid on meshes — the defining "technical drawing" look that makes
 * shaded geometry read as discrete objects rather than blobs.
 *
 * Edge segments are extracted by `extractEdgeSegments` (see edge-extract.ts — an
 * `EdgesGeometry`-equivalent that is ~an order of magnitude faster and worker-portable) and
 * rendered as fat `LineSegments2` using the same `LineMaterial` family as curves — so edges get
 * controllable thickness, not the 1px cap of `THREE.LineSegments`. The overlay is added as a
 * *child* of each mesh, so it inherits the mesh's transform and is disposed when the mesh subtree
 * is cleared.
 *
 * Performance model (docs/plans/4.edge-overlay-performance.md):
 * - Extraction results are cached at two levels: per source `BufferGeometry` (object identity,
 *   helps instanced parts within one solve) and by *content fingerprint* in an LRU — the viewer
 *   rebuilds all geometry objects every solve, so only a content key survives re-solves.
 * - {@link addEdgesAsync} runs extraction for large meshes in a Worker built from a blob URL
 *   (bundler-agnostic; falls back to inline extraction when Workers are unavailable), keeping the
 *   main thread free of the multi-second stalls extraction causes at millions of triangles.
 * - Caps bound the pathological cases: meshes above `maxTriangles` are skipped outright (tagged
 *   `userData.edgesSkipped = 'triangle-cap'`), overlays above `maxSegments` lose the distance
 *   fade so they render in the cheaper opaque pass.
 *
 * Depth strategy: edges render at TRUE depth; the mesh's own surface is pushed back a hair with
 * polygonOffset instead (see {@link setSurfaceDepthOffset}). Biasing the lines toward the camera —
 * the obvious alternative — needs a multi-ULP constant offset to survive glancing angles (fat-line
 * quads face the screen, so the slope-scaled factor term is nil), and a depth ULP grows ~quadratically
 * with distance: zoomed out, that constant becomes a meter-scale pull that makes hidden edges bleed
 * through whatever mesh is in front. Offsetting the surfaces instead lets the slope-proportional
 * factor term do the glancing-angle work, keeps the constant term at quantization scale, and leaves
 * occlusion of hidden edges exact.
 */
export interface EdgeOptions {
	/**
	 * Force a single edge color for every overlay. When omitted (the default), each overlay derives
	 * its color from its own mesh's material — a darkened tint of the surface — so edges read as the
	 * object's own outline rather than a uniform black frame. Meshes with no readable material color
	 * fall back to {@link DEFAULT_EDGE_COLOR}.
	 */
	color?: THREE.ColorRepresentation;
	/**
	 * How far to darken the derived edge color toward black, 0–1 (default 0.75). Only applies when
	 * `color` is omitted. Higher = darker edges; 0 leaves edges the surface color, 1 makes them black.
	 */
	darken?: number;
	/** Edge thickness in CSS px. Default 1.5. */
	width?: number;
	/**
	 * Crease angle in degrees: an edge is kept only where its two faces differ by more than this.
	 * Default 44. Higher = fewer edges (only sharp creases); lower = more (catches gentle bends).
	 */
	thresholdAngle?: number;
	/**
	 * Fade an overlay out as its mesh shrinks on screen (default true). Constant-px edges on a mesh
	 * covering only tens of pixels alias into dark noise; fading them keeps far zoom-outs clean.
	 */
	distanceFade?: boolean;
	/**
	 * Skip meshes above this triangle count entirely (default 4M) — extraction time is linear in
	 * triangles, and past this bound even the worker path burns seconds for a look the screen-space
	 * fallback approximates at constant cost. Skipped meshes are tagged
	 * `userData.edgesSkipped = 'triangle-cap'` so hosts can react (e.g. enable the render-pipeline
	 * edge pass).
	 */
	maxTriangles?: number;
	/**
	 * Above this many extracted segments (default 2M), an overlay drops the distance fade so it
	 * renders opaque — millions of blended fat-line quads are a fill-rate cliff; opaque ones aren't.
	 */
	maxSegments?: number;
}

/** Tag on edge overlays so pick/fit/clear logic can recognize and skip or dispose them. */
export const EDGE_USERDATA_KIND = 'edge-overlay';

/** `userData.edgesSkipped` value on meshes whose triangle count exceeded {@link EdgeOptions.maxTriangles}. */
export const EDGES_SKIPPED_TRIANGLE_CAP = 'triangle-cap';

const DEFAULT_EDGE_COLOR = 0x222222;
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_THRESHOLD_ANGLE = 44;
const DEFAULT_DARKEN = 0.75;
const DEFAULT_MAX_TRIANGLES = 4_000_000;
const DEFAULT_MAX_SEGMENTS = 2_000_000;

/**
 * Below this triangle count extraction runs inline even on the async path — a worker round-trip
 * (copy + transfer + wake) costs more than the extraction itself. Phase 0 measured three's
 * extractor at ~200 ms per 100k triangles; the replacement extractor is ~an order faster, putting
 * 25k triangles well under a frame.
 */
const INLINE_TRIANGLE_BUDGET = 25_000;

/** CPU byte budget for the cross-solve segment cache (Float32 segment arrays only). */
const SEGMENT_CACHE_BYTE_BUDGET = 128 * 1024 * 1024;

// Screen-coverage fade band, as the projected diameter of an overlay's bounding sphere in px:
// fully opaque at/above FADE_START_PX, fully gone at/below FADE_END_PX, linear between.
const FADE_START_PX = 80;
const FADE_END_PX = 20;

// Surface push-back (see module doc): factor scales with the polygon's depth slope and carries the
// glancing-angle work; units stays at quantization scale so a mesh in front of another mesh's edges
// occludes them except within ~2 depth ULPs — versus the multi-ULP (meters, zoomed out) bleed range
// a constant line-side bias had.
const SURFACE_OFFSET_FACTOR = 1;
const SURFACE_OFFSET_UNITS = 2;

/**
 * Push a mesh's shaded surface slightly back in depth (or restore it), so its edge overlay — drawn
 * at true depth — wins the depth test without any bias of its own. Mutates the mesh's material(s)
 * in place; materials shared across meshes are fine, since every mesh under an `addEdges` root gets
 * the same treatment.
 */
function setSurfaceDepthOffset(mesh: THREE.Mesh, enabled: boolean): void {
	const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
	for (const material of materials) {
		if (!material) continue;
		material.polygonOffset = enabled;
		material.polygonOffsetFactor = enabled ? SURFACE_OFFSET_FACTOR : 0;
		material.polygonOffsetUnits = enabled ? SURFACE_OFFSET_UNITS : 0;
	}
}

// ============================================================================
// Segment extraction — fast path, content cache, worker offload
// ============================================================================

function triangleCountOf(geometry: THREE.BufferGeometry): number {
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
function extractSegmentsSync(geometry: THREE.BufferGeometry, thresholdAngle: number): Float32Array {
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
function extractSegmentsAsync(
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

// ============================================================================
// Per-geometry line-geometry cache (identity-keyed, refcounted)
// ============================================================================

/**
 * Extracted edge geometry, cached per source `BufferGeometry` (and per crease angle, since the
 * angle changes which edges survive). N meshes sharing one geometry — the common case for
 * instanced/repeated parts — get one extraction and one GPU buffer instead of N identical ones.
 *
 * Reference-counted so {@link removeEdges} only disposes a line geometry once its last overlay is
 * gone. The WeakMap keys on the source geometry, so entries vanish with the content they describe;
 * overlays disposed by whole-scene clears (which bypass removeEdges) just leave a refcount behind
 * on an entry that becomes unreachable together with its source geometry.
 */
interface EdgeGeometryEntry {
	geometry: LineSegmentsGeometry;
	refCount: number;
	segmentCount: number;
}
const edgeGeometryCache = new WeakMap<THREE.BufferGeometry, Map<number, EdgeGeometryEntry>>();

function cachedEntry(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number
): EdgeGeometryEntry | undefined {
	return edgeGeometryCache.get(geometry)?.get(thresholdAngle);
}

function storeEntry(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number,
	segments: Float32Array
): EdgeGeometryEntry {
	let byAngle = edgeGeometryCache.get(geometry);
	if (!byAngle) {
		byAngle = new Map();
		edgeGeometryCache.set(geometry, byAngle);
	}
	// LineSegmentsGeometry adopts `segments` as its backing store without copying — sharing the
	// array with the segment cache and with other entries is safe (read-only from here on).
	const lineGeometry = new LineSegmentsGeometry();
	lineGeometry.setPositions(segments);
	const entry: EdgeGeometryEntry = {
		geometry: lineGeometry,
		refCount: 0,
		segmentCount: segments.length / 6
	};
	byAngle.set(thresholdAngle, entry);
	return entry;
}

/** Where an overlay's (possibly shared) line geometry came from, for refcounted disposal. */
interface EdgeOverlayUserData {
	kind: string;
	edgeSource?: THREE.BufferGeometry;
	edgeThresholdAngle?: number;
}

/** Refcounted disposal — only when the last overlay referencing an entry is gone. */
function releaseEdgeGeometry(overlay: LineSegments2): void {
	const userData = overlay.userData as EdgeOverlayUserData;
	const byAngle = userData.edgeSource && edgeGeometryCache.get(userData.edgeSource);
	const entry =
		userData.edgeThresholdAngle != null ? byAngle?.get(userData.edgeThresholdAngle) : undefined;

	if (!entry || entry.geometry !== overlay.geometry) {
		// Not (or no longer) cache-managed — dispose directly.
		overlay.geometry.dispose();
		return;
	}

	entry.refCount -= 1;
	if (entry.refCount <= 0) {
		entry.geometry.dispose();
		byAngle!.delete(userData.edgeThresholdAngle!);
	}
}

// ============================================================================
// Overlay construction
// ============================================================================

interface ResolvedOptions {
	forcedColor: THREE.Color | null;
	darken: number;
	width: number;
	thresholdAngle: number;
	distanceFade: boolean;
	maxTriangles: number;
	maxSegments: number;
}

function resolveOptions(options: EdgeOptions): ResolvedOptions {
	return {
		forcedColor: options.color != null ? new THREE.Color(options.color) : null,
		darken: THREE.MathUtils.clamp(options.darken ?? DEFAULT_DARKEN, 0, 1),
		width: options.width ?? DEFAULT_EDGE_WIDTH,
		thresholdAngle: options.thresholdAngle ?? DEFAULT_THRESHOLD_ANGLE,
		distanceFade: options.distanceFade ?? true,
		maxTriangles: options.maxTriangles ?? DEFAULT_MAX_TRIANGLES,
		maxSegments: options.maxSegments ?? DEFAULT_MAX_SEGMENTS
	};
}

/**
 * Edge color for a mesh when no color is forced: the mesh's own surface color darkened toward black
 * by `darken` (0 = surface color, 1 = black), so edges read as the object's darker outline. Falls
 * back to {@link DEFAULT_EDGE_COLOR} when no material color is readable. Multiplicative darkening
 * preserves hue and desaturates gently; a near-black surface just yields near-black edges.
 */
function deriveEdgeColor(mesh: THREE.Mesh, darken: number): THREE.Color {
	const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
	const source = (material as { color?: THREE.Color } | null)?.color;
	if (!source) return new THREE.Color(DEFAULT_EDGE_COLOR);
	return source.clone().multiplyScalar(1 - darken);
}

/**
 * Overlays sharing a color and fade mode share a material: with a forced color that's one material
 * per `addEdges` call; when deriving per-mesh, meshes of the same surface color (instanced/repeated
 * parts) still collapse onto one. The fade bit is part of the key because fading needs
 * `transparent = true` while capped overlays must stay opaque.
 */
class MaterialPool {
	private readonly byKey = new Map<number, LineMaterial>();
	constructor(private readonly options: ResolvedOptions) {}

	for(mesh: THREE.Mesh, fade: boolean): LineMaterial {
		const color = this.options.forcedColor ?? deriveEdgeColor(mesh, this.options.darken);
		const key = color.getHex() * 2 + (fade ? 1 : 0);
		let material = this.byKey.get(key);
		if (!material) {
			material = createEdgeMaterial(color, this.options.width, fade);
			this.byKey.set(key, material);
		}
		return material;
	}

	/** Dispose any material no overlay adopted (e.g. every mesh was skipped or cancelled). */
	disposeUnused(created: LineSegments2[]): void {
		const used = new Set(created.map((overlay) => overlay.material));
		for (const material of this.byKey.values()) {
			if (!used.has(material)) material.dispose();
		}
	}
}

function createEdgeMaterial(
	color: THREE.Color,
	width: number,
	distanceFade: boolean
): LineMaterial {
	// LineMaterialParameters omits linewidth/opacity from its type though both exist at runtime.
	const material = new LineMaterial({ color });
	(material as LineMaterial & { linewidth: number }).linewidth = width;
	// No depth bias here — edges render at true depth and the mesh surface recedes instead (see
	// setSurfaceDepthOffset), so edges can't bleed through meshes in front of them.
	// Fading needs blending; set once here rather than per draw, since flipping `transparent` after
	// the render list is built wouldn't re-sort the object into the transparent pass.
	if (distanceFade) material.transparent = true;
	return material;
}

function buildEdgeOverlay(
	sourceGeometry: THREE.BufferGeometry,
	entry: EdgeGeometryEntry,
	material: LineMaterial,
	thresholdAngle: number,
	distanceFade: boolean
): LineSegments2 {
	entry.refCount += 1;

	const overlay = new LineSegments2(entry.geometry, material);
	overlay.userData.kind = EDGE_USERDATA_KIND;
	// Remember which cache entry backs this overlay so removeEdges can refcount its disposal. The
	// strong reference is fine: the overlay is a child of the mesh that owns the source geometry,
	// so their lifetimes already coincide.
	overlay.userData.edgeSource = sourceGeometry;
	overlay.userData.edgeThresholdAngle = thresholdAngle;
	overlay.raycast = () => {}; // never pickable; clicks should hit the mesh, not its outline
	if (distanceFade) enableDistanceFade(overlay);
	return overlay;
}

const _fadeCenter = new THREE.Vector3();
const _fadeCameraPos = new THREE.Vector3();

/**
 * Projected diameter of the overlay's bounding sphere on screen, in px — the "how big does this
 * mesh read" signal driving the distance fade. Returns Infinity ("don't fade") when the camera is
 * inside the sphere or the projection is unknown.
 */
function projectedDiameterPx(
	overlay: LineSegments2,
	camera: THREE.Camera,
	viewportHeightPx: number
): number {
	if (!overlay.geometry.boundingSphere) overlay.geometry.computeBoundingSphere();
	const sphere = overlay.geometry.boundingSphere;
	if (!sphere || sphere.radius <= 0) return Infinity;

	const radius = sphere.radius * overlay.matrixWorld.getMaxScaleOnAxis();
	_fadeCenter.copy(sphere.center).applyMatrix4(overlay.matrixWorld);

	if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
		const perspective = camera as THREE.PerspectiveCamera;
		const distance = _fadeCameraPos
			.setFromMatrixPosition(camera.matrixWorld)
			.distanceTo(_fadeCenter);
		if (distance <= radius) return Infinity; // camera inside the mesh — no fade
		const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(perspective.fov) * 0.5);
		return (radius / (distance * tanHalfFov)) * viewportHeightPx;
	}
	if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
		const ortho = camera as THREE.OrthographicCamera;
		const worldHeight = (ortho.top - ortho.bottom) / ortho.zoom;
		return worldHeight > 0 ? ((2 * radius) / worldHeight) * viewportHeightPx : Infinity;
	}
	return Infinity;
}

/**
 * Fade this overlay by its on-screen size (see FADE_START_PX/FADE_END_PX). Hooked into
 * onBeforeRender so the opacity is written immediately before *this* overlay's draw — uniforms
 * upload per draw call, so overlays sharing one material still fade independently. Chains
 * LineSegments2's own onBeforeRender, which keeps the material's resolution uniform in sync.
 */
function enableDistanceFade(overlay: LineSegments2): void {
	// Assign via the Object3D base type: LineSegments2's typings narrow onBeforeRender to
	// (renderer) only, but the renderer actually calls it with (renderer, scene, camera, …).
	(overlay as THREE.Object3D).onBeforeRender = (renderer, _scene, camera) => {
		LineSegments2.prototype.onBeforeRender.call(overlay, renderer);
		const material = overlay.material as LineMaterial;
		const coverage = projectedDiameterPx(overlay, camera, material.resolution.y);
		material.opacity = THREE.MathUtils.clamp(
			(coverage - FADE_END_PX) / (FADE_START_PX - FADE_END_PX),
			0,
			1
		);
	};
}

// ============================================================================
// Public API — add / remove / query
// ============================================================================

/** Whether an object is an edge overlay (for pick/fit filters elsewhere). */
export function isEdgeOverlay(object: THREE.Object3D): boolean {
	return object.userData?.kind === EDGE_USERDATA_KIND;
}

/** Meshes under `root` that should get an overlay: content meshes without one, caps applied. */
function collectTargets(root: THREE.Object3D, maxTriangles: number): THREE.Mesh[] {
	const targets: THREE.Mesh[] = [];
	root.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		if (object.userData.id === 'floor' || object.userData.id === 'grid') return;
		if (object.userData.kind === EDGE_USERDATA_KIND) return;
		if (object.children.some((c) => c.userData?.kind === EDGE_USERDATA_KIND)) return; // already done
		if (!object.geometry) return;

		if (triangleCountOf(object.geometry) > maxTriangles) {
			object.userData.edgesSkipped = EDGES_SKIPPED_TRIANGLE_CAP;
			// eslint-disable-next-line no-console
			console.debug(
				`[edges] skipping mesh over triangle cap (${triangleCountOf(object.geometry)} > ${maxTriangles})`
			);
			return;
		}
		delete object.userData.edgesSkipped;
		targets.push(object);
	});
	return targets;
}

function attachOverlay(
	mesh: THREE.Mesh,
	entry: EdgeGeometryEntry,
	materials: MaterialPool,
	resolved: ResolvedOptions
): LineSegments2 {
	// Distance fade needs the transparent pass; overlays over the segment cap stay opaque instead
	// of skipping outright — see EdgeOptions.maxSegments.
	const fade = resolved.distanceFade && entry.segmentCount <= resolved.maxSegments;
	const overlay = buildEdgeOverlay(
		mesh.geometry,
		entry,
		materials.for(mesh, fade),
		resolved.thresholdAngle,
		fade
	);
	mesh.add(overlay); // child → inherits transform, disposed with the parent subtree
	setSurfaceDepthOffset(mesh, true); // surface recedes a hair so the true-depth edges win
	return overlay;
}

/**
 * Walk an object subtree and attach an edge overlay to every `Mesh` found, returning the created
 * overlays (so callers can dispose them explicitly if they don't clear the whole subtree). Meshes
 * that already carry an overlay are skipped, so this is safe to call more than once.
 *
 * Skips the floor and the grid (they're aids, not content) and anything already tagged as an edge.
 *
 * Fully synchronous — extraction for every mesh runs on the calling thread. Interactive hosts with
 * potentially-large meshes should prefer {@link addEdgesAsync}, which offloads big extractions to
 * a worker.
 */
export function addEdges(root: THREE.Object3D, options: EdgeOptions = {}): LineSegments2[] {
	const resolved = resolveOptions(options);
	const materials = new MaterialPool(resolved);
	const created: LineSegments2[] = [];

	for (const mesh of collectTargets(root, resolved.maxTriangles)) {
		const entry =
			cachedEntry(mesh.geometry, resolved.thresholdAngle) ??
			storeEntry(
				mesh.geometry,
				resolved.thresholdAngle,
				extractSegmentsSync(mesh.geometry, resolved.thresholdAngle)
			);
		created.push(attachOverlay(mesh, entry, materials, resolved));
	}

	materials.disposeUnused(created);
	return created;
}

/**
 * Generation per root: {@link removeEdges} bumps it, and async attaches landing after a bump are
 * dropped — so "toggle off while extracting" can't resurrect overlays. Keyed on the root object,
 * which hosts keep stable across solves (the scene).
 */
const rootGenerations = new WeakMap<THREE.Object3D, number>();

function generationOf(root: THREE.Object3D): number {
	return rootGenerations.get(root) ?? 0;
}

/** Is `mesh` still reachable from `root`? Guards attaches racing scene clears. */
function isConnected(mesh: THREE.Object3D, root: THREE.Object3D): boolean {
	for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
		if (node === root) return true;
	}
	return false;
}

/**
 * Like {@link addEdges}, but extraction for large meshes runs in a Worker so the main thread never
 * stalls. Small meshes (< ~25k triangles) still attach synchronously before this returns — only
 * heavy extractions arrive a beat later. Resolves with every overlay actually attached.
 *
 * Late results are dropped (never attached) when the mesh has left the root's subtree (scene was
 * cleared by a newer solve), the root's edges were removed via {@link removeEdges}, or another
 * apply already attached an overlay to that mesh.
 */
export async function addEdgesAsync(
	root: THREE.Object3D,
	options: EdgeOptions = {}
): Promise<LineSegments2[]> {
	const resolved = resolveOptions(options);
	const materials = new MaterialPool(resolved);
	const generation = generationOf(root);
	const created: LineSegments2[] = [];

	const attaches = collectTargets(root, resolved.maxTriangles).map(async (mesh) => {
		let entry = cachedEntry(mesh.geometry, resolved.thresholdAngle);
		if (!entry) {
			const segments = await extractSegmentsAsync(mesh.geometry, resolved.thresholdAngle);
			// Things may have moved on while extracting — attach only if this apply is still wanted.
			if (generationOf(root) !== generation) return;
			if (!isConnected(mesh, root)) return;
			if (mesh.children.some((c) => c.userData?.kind === EDGE_USERDATA_KIND)) return;
			entry = cachedEntry(mesh.geometry, resolved.thresholdAngle);
			if (!entry) entry = storeEntry(mesh.geometry, resolved.thresholdAngle, segments);
		}
		created.push(attachOverlay(mesh, entry, materials, resolved));
	});

	await Promise.all(attaches);
	materials.disposeUnused(created);
	return created;
}

/**
 * Remove every edge overlay under `root`, disposing its geometry and material. The inverse of
 * {@link addEdges}/{@link addEdgesAsync}; together they make edges a live on/off toggle — this
 * also cancels any in-flight async attaches for `root`. Returns how many were removed.
 */
export function removeEdges(root: THREE.Object3D): number {
	rootGenerations.set(root, generationOf(root) + 1);

	const overlays: LineSegments2[] = [];
	root.traverse((object) => {
		if (object instanceof LineSegments2 && isEdgeOverlay(object)) overlays.push(object);
	});

	// One addEdges call shares one material across its overlays — dispose each distinct one once.
	// (If `root` covers only part of a call's overlays, survivors self-heal: three recompiles a
	// disposed-but-still-referenced material on its next use.)
	const materials = new Set<LineMaterial>();
	for (const overlay of overlays) {
		releaseEdgeGeometry(overlay); // geometry may be shared across overlays — refcounted dispose
		materials.add(overlay.material as LineMaterial);
		// Undo the surface push-back that existed only for this overlay's benefit.
		if (overlay.parent instanceof THREE.Mesh) setSurfaceDepthOffset(overlay.parent, false);
		overlay.removeFromParent();
	}
	materials.forEach((material) => material.dispose());
	return overlays.length;
}
