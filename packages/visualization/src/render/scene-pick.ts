import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

import { isEdgeOverlay } from './edges.js';
import { isViewerAidRoot } from './three-helpers.js';

// ============================================================================
// Hover-rate picking for large scenes
// ============================================================================
//
// `raycaster.intersectObjects(scene, true)` tests every triangle of every mesh the ray's bounding
// sphere touches. A merged IFC-scale mesh is millions of triangles, so a per-frame hover pick
// stalls the page. Meshes here go through a BVH instead, built once per geometry on first touch.
//
// The BVH is `indirect` and built from a group-less proxy: a default BVH reorders the index buffer,
// which would break the merged-member windows in `userData.members`, and it bakes the geometry's
// groups in at build time, while `shared/merged-draw.ts` rewrites groups on every hide/highlight.
// Hidden members are filtered per hit instead, against the groups as they stand now.

interface CachedBvh {
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
	positionVersion: number;
	indexVersion: number;
	bvh: MeshBVH;
}

// Keyed by the index (or position) attribute, not the geometry: `merged-draw` swaps a cached
// geometry for a fresh one over the same attributes, and that must not trigger a rebuild.
const bvhCache = new WeakMap<object, CachedBvh | null>();

function versionOf(attribute: { version?: number } | null): number {
	return attribute?.version ?? 0;
}

/** BVH for a mesh geometry, building it on first use. Null when the geometry can't take one. */
export function bvhFor(geometry: THREE.BufferGeometry): MeshBVH | null {
	const position = geometry.attributes.position;
	if (!position || position.count === 0) return null;
	const index = geometry.index;
	const key = index ?? position;

	const cached = bvhCache.get(key);
	if (cached === null) return null;
	if (
		cached &&
		cached.position === position &&
		cached.positionVersion === versionOf(position as THREE.BufferAttribute) &&
		cached.indexVersion === versionOf(index)
	) {
		return cached.bvh;
	}

	const proxy = new THREE.BufferGeometry();
	proxy.setAttribute('position', position);
	if (index) proxy.setIndex(index);
	try {
		const bvh = new MeshBVH(proxy, { indirect: true });
		bvhCache.set(key, {
			position,
			positionVersion: versionOf(position as THREE.BufferAttribute),
			indexVersion: versionOf(index),
			bvh
		});
		return bvh;
	} catch {
		// Malformed geometry (index count not a multiple of 3, …): fall back to three's raycast.
		bvhCache.set(key, null);
		return null;
	}
}

function isBvhMesh(object: THREE.Object3D): object is THREE.Mesh {
	const o = object as THREE.Object3D & Record<string, unknown>;
	// Line2/LineSegments2 are Meshes too, but their triangles are screen-space quads.
	return (
		o.isMesh === true &&
		!o.isInstancedMesh &&
		!o.isSkinnedMesh &&
		!o.isBatchedMesh &&
		!o.isLineSegments2 &&
		!(object as THREE.Mesh).morphTargetInfluences?.length
	);
}

/**
 * Visible, pickable objects under `root`: hidden subtrees, viewer aids and edge overlays are
 * skipped. Overlays are skipped because they double the mesh's own edges and, as fat lines, cost a
 * linear scan of every segment per ray.
 */
export function collectPickable(
	root: THREE.Object3D,
	out: THREE.Object3D[] = []
): THREE.Object3D[] {
	for (const child of root.children) {
		if (!child.visible || isViewerAidRoot(child) || isEdgeOverlay(child)) continue;
		out.push(child);
		collectPickable(child, out);
	}
	return out;
}

/**
 * Index-buffer ranges a merged mesh currently draws, or null when it draws everything. Hidden
 * members are the gaps between groups (`shared/merged-draw.ts`).
 */
function drawnRanges(mesh: THREE.Mesh): { start: number; end: number }[] | null {
	const { groups } = mesh.geometry;
	if (!Array.isArray(mesh.material) || groups.length === 0) return null;
	const materials = mesh.material;
	return groups
		.filter((g) => materials[g.materialIndex ?? 0]?.visible !== false)
		.map((g) => ({ start: g.start, end: g.start + g.count }));
}

const _inverse = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _sphere = new THREE.Sphere();

function raycastMeshBvh(
	mesh: THREE.Mesh,
	bvh: MeshBVH,
	raycaster: THREE.Raycaster
): THREE.Intersection | null {
	_inverse.copy(mesh.matrixWorld).invert();
	_localRay.copy(raycaster.ray).applyMatrix4(_inverse);

	const ranges = drawnRanges(mesh);
	let best: THREE.Intersection | null = null;
	if (!ranges) {
		best = bvh.raycastFirst(_localRay, THREE.DoubleSide);
	} else {
		for (const hit of bvh.raycast(_localRay, THREE.DoubleSide)) {
			const at = (hit.faceIndex ?? 0) * 3;
			if (!ranges.some((r) => at >= r.start && at < r.end)) continue;
			if (!best || hit.distance < best.distance) best = hit;
		}
	}
	if (!best) return null;

	best.point.applyMatrix4(mesh.matrixWorld);
	best.distance = best.point.distanceTo(raycaster.ray.origin);
	best.object = mesh;
	if (best.distance < raycaster.near || best.distance > raycaster.far) return null;
	return best;
}

/**
 * Every hit along `raycaster`'s ray over the visible content of `scene`, nearest first. Meshes use
 * the BVH; lines, points and instanced meshes fall back to their own `raycast`.
 */
export function raycastVisible(
	scene: THREE.Object3D,
	raycaster: THREE.Raycaster
): THREE.Intersection[] {
	const hits: THREE.Intersection[] = [];
	for (const object of collectPickable(scene)) {
		if (!object.layers.test(raycaster.layers)) continue;

		if (isBvhMesh(object)) {
			const { geometry } = object;
			if (!geometry.boundingSphere) geometry.computeBoundingSphere();
			if (!geometry.boundingSphere) continue;
			_sphere.copy(geometry.boundingSphere).applyMatrix4(object.matrixWorld);
			if (!raycaster.ray.intersectsSphere(_sphere)) continue;

			const bvh = bvhFor(geometry);
			if (bvh) {
				const hit = raycastMeshBvh(object, bvh, raycaster);
				if (hit) hits.push(hit);
				continue;
			}
		}
		object.raycast(raycaster, hits);
	}
	return hits.sort((a, b) => a.distance - b.distance);
}

/**
 * Builds BVHs for the visible meshes under `root` one per idle slice, so the first hover over a
 * large model doesn't pay for all of them at once. Returns a cancel function.
 */
export function warmPickIndex(root: THREE.Object3D): () => void {
	const queue = collectPickable(root).filter(isBvhMesh);
	const idle =
		typeof requestIdleCallback === 'function'
			? (fn: () => void) => requestIdleCallback(fn, { timeout: 500 })
			: (fn: () => void) => setTimeout(fn, 16) as unknown as number;
	const cancelIdle =
		typeof cancelIdleCallback === 'function'
			? cancelIdleCallback
			: (id: number) => clearTimeout(id);

	let handle = 0;
	let cancelled = false;
	const step = () => {
		if (cancelled) return;
		const mesh = queue.shift();
		if (!mesh) return;
		bvhFor(mesh.geometry);
		handle = idle(step);
	};
	handle = idle(step);
	return () => {
		cancelled = true;
		cancelIdle(handle);
	};
}
