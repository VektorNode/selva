import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { buildLineGeometry, type EdgeGeometryEntry } from './edges/line-geometry.js';
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
 * Crisp boundary/crease edges overlaid on meshes — the "technical drawing" look that makes shaded
 * geometry read as discrete objects rather than blobs.
 *
 * Segments come from `extractEdgeSegments` (edge-extract.ts — an `EdgesGeometry`-equivalent, ~10x
 * faster and worker-portable) and render as fat `LineSegments2` (same `LineMaterial` family as
 * curves), giving controllable thickness instead of the 1px cap of `THREE.LineSegments`. Each
 * overlay is a *child* of its mesh — inherits its transform, disposed with the mesh subtree.
 *
 * Performance model (docs/plans/edge-overlay-open.md):
 * - Extraction is cached by *content fingerprint* in an LRU (`edges/extraction.ts`), since the
 *   viewer rebuilds every geometry object each solve — only a content key survives that. A second,
 *   identity-keyed cache of the built `LineSegmentsGeometry` was removed 2026-07-30: 0/80 hit rate
 *   in the real solve loop (scene clears reset it every solve), saved only 3.8ms against the 71ms
 *   the content cache already absorbs, and cost a refcount protocol plus one live leak.
 * - {@link addEdgesAsync} runs extraction for large meshes in a Worker (blob-URL based, bundler
 *   agnostic; falls back to inline when Workers are unavailable) to avoid the multi-second main
 *   thread stalls extraction causes at millions of triangles.
 * - `maxTriangles` skips pathological meshes outright (tags `userData.edgesSkipped =
 *   'triangle-cap'`); `maxSegments` drops distance fade on oversized overlays so they render in
 *   the cheaper opaque pass.
 *
 * Depth strategy: surfaces render at TRUE depth; lines carry a small units-only polygonOffset
 * toward the camera (EDGE_OFFSET_FACTOR/UNITS in `edges/options.ts`).
 *
 * This reverses an earlier approach that pushed each mesh's *surface* back with a slope-scaled
 * offset instead. That bled badly: the slope term scales with dZ/dpixel, huge on a near-edge-on
 * surface, so grazing faces receded far more than the millimetre gaps between stacked parts —
 * geometry behind a wall then drew through the wall's own receded surface. It also clobbered the
 * polygonOffset that look presets configure, and its "restore" path zeroed that instead of
 * restoring the preset's value.
 *
 * A units-only bias on the lines is bounded by construction — a fixed number of depth quantization
 * steps regardless of viewing angle — so it lifts an edge off its own coplanar surface without ever
 * reaching a neighbouring part. The caveat: a depth ULP grows ~quadratically with viewing distance,
 * so a constant bias is only safe while ULPs stay small. The dynamic near-plane fitter
 * (near-plane.ts) is what buys that — it keeps `camera.near` proportional to the camera↔content
 * gap, holding ULPs at micron scale even zoomed out. Weakening the near fit will make this bias
 * start to bleed.
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
	const overlay = buildEdgeOverlay(entry, materials.for(mesh, fade), fade);
	mesh.add(overlay); // child → inherits transform, disposed with the parent subtree
	return overlay;
}

/**
 * Attach an edge overlay to every `Mesh` in `root`'s subtree, returning the created overlays.
 * Idempotent — meshes that already carry an overlay are skipped. Skips the floor/grid aids.
 *
 * Fully synchronous, extraction included. Prefer {@link addEdgesAsync} for interactive hosts with
 * potentially-large meshes.
 */
export function addEdges(root: THREE.Object3D, options: EdgeOptions = {}): LineSegments2[] {
	const resolved = resolveOptions(options);
	const materials = new MaterialPool(resolved);
	const created: LineSegments2[] = [];

	for (const mesh of collectTargets(root, resolved.maxTriangles)) {
		// Extraction itself is cached by content (`extraction.ts`), which is where the savings are;
		// the line geometry is per-overlay and owned by it.
		const segments = extractSegmentsSync(mesh.geometry, resolved.thresholdAngle);
		created.push(attachOverlay(mesh, buildLineGeometry(segments), materials, resolved));
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
 * Like {@link addEdges}, but large-mesh extraction runs in a Worker so the main thread never
 * stalls; small meshes still attach synchronously before this resolves. Resolves with every
 * overlay actually attached — late results are dropped when the mesh left the subtree (scene
 * cleared by a newer solve), {@link removeEdges} ran for this root, or another apply already
 * attached one to that mesh.
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
		const segments = await extractSegmentsAsync(mesh.geometry, resolved.thresholdAngle);
		// Things may have moved on while extracting — attach only if this apply is still wanted.
		if (generationOf(root) !== generation) return;
		if (!isConnected(mesh, root)) return;
		if (mesh.children.some((c) => c.userData?.kind === EDGE_USERDATA_KIND)) return;
		created.push(attachOverlay(mesh, buildLineGeometry(segments), materials, resolved));
	});

	await Promise.all(attaches);
	materials.disposeUnused(created);
	return created;
}

/**
 * Remove every edge overlay under `root`, disposing geometry and material, and cancels any
 * in-flight async attaches for `root`. Inverse of {@link addEdges}/{@link addEdgesAsync}. Returns
 * the count removed.
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
		overlay.geometry.dispose(); // each overlay owns its line geometry outright
		materials.add(overlay.material as LineMaterial);
		// Nothing to undo on the parent mesh: the depth bias lives entirely on the overlay's own
		// material, so surfaces keep whatever polygonOffset their look preset configured.
		overlay.removeFromParent();
	}
	materials.forEach((material) => material.dispose());
	return overlays.length;
}
