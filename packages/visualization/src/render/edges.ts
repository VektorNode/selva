import * as THREE from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import { buildLineGeometry, type EdgeGeometryEntry } from './edges/line-geometry.js';
import { extractSegmentsAsync, extractSegmentsSync, triangleCountOf } from './edges/extraction.js';
import {
	EDGES_SKIPPED_OVERLAY_BUDGET,
	EDGES_SKIPPED_TRIANGLE_CAP,
	EDGE_USERDATA_KIND,
	resolveOptions,
	type EdgeOptions,
	type ResolvedOptions
} from './edges/options.js';
import { MaterialPool, buildEdgeOverlay } from './edges/overlay.js';

/**
 * Crisp boundary/crease edges overlaid on meshes, rendered as fat `LineSegments2` (controllable
 * thickness, unlike the 1px cap of `THREE.LineSegments`). Depth-offset rationale for the overlay
 * lines: see `EDGE_OFFSET_FACTOR`/`EDGE_OFFSET_UNITS` in `edges/options.ts`.
 */
export type { EdgeOptions };
export { EDGE_USERDATA_KIND, EDGES_SKIPPED_TRIANGLE_CAP, EDGES_SKIPPED_OVERLAY_BUDGET };

// ============================================================================
// Public API — add / remove / query
// ============================================================================

/** For pick/fit filters elsewhere to exclude overlays from hit-testing. */
export function isEdgeOverlay(object: THREE.Object3D): boolean {
	return object.userData?.kind === EDGE_USERDATA_KIND;
}

/**
 * Meshes under `root` that should get an overlay: content meshes without one, caps applied.
 *
 * Two caps, and they fail in opposite directions. `maxTriangles` is per mesh and rejects the rare
 * enormous one; `maxOverlays` is a budget over the whole set and rejects the far more common case
 * of thousands of small ones, which no per-mesh test can see. Overlays already attached from an
 * earlier apply are counted against the budget, so a re-apply can't creep past it.
 */
function collectTargets(root: THREE.Object3D, resolved: ResolvedOptions): THREE.Mesh[] {
	const candidates: THREE.Mesh[] = [];
	let existingOverlays = 0;

	root.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		if (object.userData.id === 'floor' || object.userData.id === 'grid') return;
		if (object.userData.kind === EDGE_USERDATA_KIND) return;
		if (object.children.some((c) => c.userData?.kind === EDGE_USERDATA_KIND)) {
			existingOverlays++;
			return;
		}
		if (!object.geometry) return;

		if (triangleCountOf(object.geometry) > resolved.maxTriangles) {
			object.userData.edgesSkipped = EDGES_SKIPPED_TRIANGLE_CAP;
			return;
		}
		candidates.push(object);
	});

	const budget = Math.max(0, resolved.maxOverlays - existingOverlays);
	const targets = candidates.slice(0, budget);
	for (const mesh of targets) delete mesh.userData.edgesSkipped;
	for (const mesh of candidates.slice(budget)) {
		mesh.userData.edgesSkipped = EDGES_SKIPPED_OVERLAY_BUDGET;
	}

	if (candidates.length > budget) {
		// eslint-disable-next-line no-console
		console.debug(
			`[edges] overlay budget reached: ${candidates.length} meshes want overlays, ` +
				`${budget} allowed — the rest fall back to the screen-space edge pass.`
		);
	}

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

	for (const mesh of collectTargets(root, resolved)) {
		// Extraction itself is cached by content (`extraction.ts`), which is where the savings are;
		// the line geometry is per-overlay and owned by it.
		const segments = extractSegmentsSync(mesh.geometry, resolved.thresholdAngle);
		created.push(attachOverlay(mesh, buildLineGeometry(segments), materials, resolved));
	}

	materials.disposeUnused(created);
	return created;
}

/**
 * {@link removeEdges} bumps this per root; async attaches landing after a bump are dropped, so
 * "toggle off while extracting" can't resurrect overlays.
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
 * overlay actually attached — late results are dropped if the mesh left the subtree,
 * {@link removeEdges} ran for this root meanwhile, or another apply already attached one to that
 * mesh.
 */
export async function addEdgesAsync(
	root: THREE.Object3D,
	options: EdgeOptions = {}
): Promise<LineSegments2[]> {
	const resolved = resolveOptions(options);
	const materials = new MaterialPool(resolved);
	const generation = generationOf(root);
	const created: LineSegments2[] = [];

	const attaches = collectTargets(root, resolved).map(async (mesh) => {
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
