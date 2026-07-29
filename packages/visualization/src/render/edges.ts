import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import {
	cachedEntry,
	releaseEdgeGeometry,
	storeEntry,
	type EdgeGeometryEntry
} from './edges/cache.js';
import { extractSegmentsAsync, extractSegmentsSync, triangleCountOf } from './edges/extraction.js';
import {
	EDGES_SKIPPED_TRIANGLE_CAP,
	EDGE_USERDATA_KIND,
	resolveOptions,
	type EdgeOptions,
	type ResolvedOptions
} from './edges/options.js';
import { MaterialPool, buildEdgeOverlay } from './edges/overlay.js';

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
 *   rebuilds all geometry objects every solve, so only a content key survives re-solves. Both live
 *   in `edges/cache.ts` and `edges/extraction.ts`.
 * - {@link addEdgesAsync} runs extraction for large meshes in a Worker built from a blob URL
 *   (bundler-agnostic; falls back to inline extraction when Workers are unavailable), keeping the
 *   main thread free of the multi-second stalls extraction causes at millions of triangles.
 * - Caps bound the pathological cases: meshes above `maxTriangles` are skipped outright (tagged
 *   `userData.edgesSkipped = 'triangle-cap'`), overlays above `maxSegments` lose the distance
 *   fade so they render in the cheaper opaque pass.
 *
 * Depth strategy: surfaces render at TRUE depth, untouched; the LINES carry a small units-only
 * polygonOffset toward the camera (see EDGE_OFFSET_FACTOR/UNITS in `edges/options.ts`).
 *
 * This reverses an earlier strategy that instead pushed each mesh's *surface* back with a
 * slope-scaled offset (factor 1, units 2). That version bled badly: the slope term scales with
 * dZ/dpixel, which is enormous on a surface viewed near edge-on, so grazing faces receded by much
 * more than the millimetre gaps between stacked parts — geometry behind a wall then beat the wall's
 * own receded surface and drew through it. It also clobbered the polygonOffset that look presets
 * configure on their materials, and its "restore" path reset those to 0 rather than to the preset's
 * values.
 *
 * A units-only bias on the lines is bounded by construction: a fixed number of depth quantization
 * steps, independent of viewing angle, so it lifts an edge off its own coplanar surface without ever
 * reaching across to a neighbouring part.
 *
 * The caveat the old strategy correctly identified: a depth ULP grows ~quadratically with viewing
 * distance, so a constant bias is only safe while ULPs stay small. That is what the dynamic
 * near-plane fitter (near-plane.ts) buys — it keeps `camera.near` proportional to the camera↔content
 * gap, holding ULPs at micron scale even zoomed well out. The two mechanisms are load-bearing
 * together; weakening the near fit will make this bias start to bleed.
 */
export type { EdgeOptions };
export { EDGE_USERDATA_KIND, EDGES_SKIPPED_TRIANGLE_CAP };

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
		// Nothing to undo on the parent mesh: the depth bias lives entirely on the overlay's own
		// material, so surfaces keep whatever polygonOffset their look preset configured.
		overlay.removeFromParent();
	}
	materials.forEach((material) => material.dispose());
	return overlays.length;
}
