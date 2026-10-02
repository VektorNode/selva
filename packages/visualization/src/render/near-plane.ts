import * as THREE from 'three';

import { EDGE_USERDATA_KIND } from './edges/options.js';
import { membersOf } from './scene-setup/merged-picking.js';
import { isViewerAidRoot } from './three-helpers.js';

/**
 * Depth-buffer precision is ∝ near/z²: at the 0.01 m floor a 24-bit buffer resolves ~0.15 mm at
 * 5 m and ~0.25 m at 200 m, so a sheet's two faces fight up close and coplanar surfaces fight far
 * away. Pushing `near` up to a fraction of the view depth of the nearest geometry in view recovers
 * that precision without clipping anything.
 *
 * The nearest geometry is measured on per-chunk triangle bounds, not the scene's bounding sphere:
 * zoomed in on a detail, the camera sits inside the whole model's sphere, which pinned near to the
 * floor exactly when precision mattered most. Chunks outside the frustum's side planes are skipped,
 * since geometry nobody sees can't be clipped.
 *
 * `far` stays owned by config/`updateScene` (must keep covering grid fade, floor). External writes
 * to `camera.near` are adopted as the new lower bound rather than fought — the fitter only ever
 * *raises* near above that floor.
 *
 * Ortho camera needs no fitting (linear depth) and is left untouched.
 */

/** Safety margin: a host's `onFrame` can still move the camera after the fit. */
const NEAR_GAP_FRACTION = 0.5;
/** Caps near so the frustum stays sane if the camera flies out. */
const MAX_NEAR_TO_FAR = 0.01;
/** Skip sub-5% changes so the projection matrix isn't rebuilt every frame while orbiting. */
const APPLY_THRESHOLD = 0.05;
/**
 * Triangles per bounding box. Smaller fits tighter up close but costs more box tests per frame:
 * at 256, a 2M-triangle model is ~8k tests, well under a millisecond.
 */
const TRIANGLES_PER_CHUNK = 256;

export interface NearPlaneFitterOptions {
	camera: THREE.PerspectiveCamera;
	scene: THREE.Scene;
	/**
	 * Unit normals of ground planes through the origin carrying ground aids (grid, floor) — their
	 * perpendicular distance to the camera also bounds near, since the aid re-centers under the
	 * camera and content distance alone would clip it at grazing views.
	 *
	 * Pass a callback returning only planes whose aid is visible this frame: an aid that's hidden
	 * (not merely absent) must not collapse `near` to protect geometry nobody can see.
	 */
	groundNormals?: () => THREE.Vector3[];
}

export interface NearPlaneFitter {
	update: () => void;
}

const NO_GROUND_NORMALS: THREE.Vector3[] = [];

export function createNearPlaneFitter({
	camera,
	scene,
	groundNormals = () => NO_GROUND_NORMALS
}: NearPlaneFitterOptions): NearPlaneFitter {
	let baseNear = camera.near;
	let appliedNear = camera.near;

	const nearest = createNearestDepthQuery();

	const update = () => {
		if (camera.near !== appliedNear) baseNear = camera.near; // external write → new floor

		const depth = nearest.measure(scene, camera);
		let near = baseNear;
		if (depth !== null) {
			let gap = depth;
			for (const normal of groundNormals()) {
				gap = Math.min(gap, Math.abs(camera.position.dot(normal)));
			}
			near = THREE.MathUtils.clamp(gap * NEAR_GAP_FRACTION, baseNear, camera.far * MAX_NEAR_TO_FAR);
		}

		if (Math.abs(near - appliedNear) > appliedNear * APPLY_THRESHOLD) {
			camera.near = near;
			camera.updateProjectionMatrix();
			appliedNear = near;
		}
	};

	return { update };
}

// ============================================================================
// Nearest view depth
// ============================================================================

interface Chunks {
	/** min xyz, max xyz per chunk, in the geometry's local space. */
	boxes: Float32Array;
	/** First and past-the-end triangle per chunk. */
	ranges: Uint32Array;
}

interface ChunkBounds extends Chunks {
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
	positionVersion: number;
	index: THREE.BufferAttribute | null;
	indexVersion: number;
}

/**
 * Smallest view depth (distance along the camera's forward axis) of any content inside the
 * frustum's side planes: `null` when the scene has no content, `Infinity` when none of it is in
 * view.
 *
 * A chunk's box only bounds that depth from below, and loosely: a big box reaches beside and behind
 * the camera even when its triangles are all well ahead. One 60-triangle wall around a building is
 * one box the size of the building, which used to pin near to the floor from anywhere in it. So a
 * box that could still be the nearest has its triangles clipped to the frustum and measured
 * exactly; boxes already further than the best so far are skipped.
 */
function createNearestDepthQuery() {
	const chunkCache = new WeakMap<THREE.BufferGeometry, ChunkBounds>();
	const frustum = new THREE.Frustum();
	const viewProjection = new THREE.Matrix4();
	const forward = new THREE.Vector3();
	const box = new THREE.Box3();
	// Four side planes then the depth plane, each (a, b, c, d) with a·x + b·y + c·z + d.
	const worldPlanes = new Float64Array(20);
	const localPlanes = new Float64Array(20);
	const singleBox = new Float32Array(6);
	// Sutherland–Hodgman ping-pong buffers: a triangle clipped by four planes keeps at most 7 corners.
	let polygon = new Float64Array(21);
	let clipped = new Float64Array(21);

	let nearest = Infinity;
	let sawContent = false;

	const chunksOf = (object: THREE.Object3D, geometry: THREE.BufferGeometry): ChunkBounds => {
		const position = geometry.getAttribute('position');
		const index = geometry.getIndex();
		const cached = chunkCache.get(geometry);
		if (
			cached &&
			cached.position === position &&
			cached.positionVersion === versionOf(position) &&
			cached.index === index &&
			cached.indexVersion === (index?.version ?? -1)
		) {
			return cached;
		}
		const built: ChunkBounds = {
			...buildChunkBoxes(position, index, memberStarts(object)),
			position,
			positionVersion: versionOf(position),
			index,
			indexVersion: index?.version ?? -1
		};
		chunkCache.set(geometry, built);
		return built;
	};

	/** Exact nearest depth of a chunk's triangles inside the frustum's side planes. */
	const chunkDepth = (chunks: ChunkBounds, chunk: number, planes: Float64Array): number => {
		const { position, index } = chunks;
		const indices = index?.array as ArrayLike<number> | undefined;
		let best = Infinity;
		for (let t = chunks.ranges[chunk * 2]!; t < chunks.ranges[chunk * 2 + 1]!; t++) {
			for (let corner = 0; corner < 3; corner++) {
				const v = indices ? indices[t * 3 + corner]! : t * 3 + corner;
				polygon[corner * 3] = position.getX(v);
				polygon[corner * 3 + 1] = position.getY(v);
				polygon[corner * 3 + 2] = position.getZ(v);
			}
			let count = 3;
			for (let p = 0; p < 16 && count > 0; p += 4) {
				const a = planes[p]!;
				const b = planes[p + 1]!;
				const c = planes[p + 2]!;
				const d = planes[p + 3]!;
				let kept = 0;
				for (let i = 0; i < count; i++) {
					const j = (i + 1) % count;
					const ix = polygon[i * 3]!;
					const iy = polygon[i * 3 + 1]!;
					const iz = polygon[i * 3 + 2]!;
					const jx = polygon[j * 3]!;
					const jy = polygon[j * 3 + 1]!;
					const jz = polygon[j * 3 + 2]!;
					const di = a * ix + b * iy + c * iz + d;
					const dj = a * jx + b * jy + c * jz + d;
					if (di >= 0) {
						clipped[kept * 3] = ix;
						clipped[kept * 3 + 1] = iy;
						clipped[kept * 3 + 2] = iz;
						kept++;
					}
					if (di >= 0 !== dj >= 0) {
						const f = di / (di - dj);
						clipped[kept * 3] = ix + (jx - ix) * f;
						clipped[kept * 3 + 1] = iy + (jy - iy) * f;
						clipped[kept * 3 + 2] = iz + (jz - iz) * f;
						kept++;
					}
				}
				[polygon, clipped] = [clipped, polygon];
				count = kept;
			}
			for (let i = 0; i < count; i++) {
				const depth =
					planes[16]! * polygon[i * 3]! +
					planes[17]! * polygon[i * 3 + 1]! +
					planes[18]! * polygon[i * 3 + 2]! +
					planes[19]!;
				if (depth < best) best = depth;
			}
		}
		return best;
	};

	// Moves the world planes into the object's local space instead of moving every box into world
	// space: p_world = L·p + t, so n·p_world + d = (Lᵀn)·p + (n·t + d).
	const toLocalPlanes = (matrix: THREE.Matrix4): Float64Array => {
		const e = matrix.elements;
		for (let i = 0; i < 20; i += 4) {
			const nx = worldPlanes[i]!;
			const ny = worldPlanes[i + 1]!;
			const nz = worldPlanes[i + 2]!;
			localPlanes[i] = e[0]! * nx + e[1]! * ny + e[2]! * nz;
			localPlanes[i + 1] = e[4]! * nx + e[5]! * ny + e[6]! * nz;
			localPlanes[i + 2] = e[8]! * nx + e[9]! * ny + e[10]! * nz;
			localPlanes[i + 3] = nx * e[12]! + ny * e[13]! + nz * e[14]! + worldPlanes[i + 3]!;
		}
		return localPlanes;
	};

	const testBoxes = (boxes: Float32Array, planes: Float64Array, chunks?: ChunkBounds) => {
		outer: for (let b = 0; b < boxes.length; b += 6) {
			const minX = boxes[b]!;
			const minY = boxes[b + 1]!;
			const minZ = boxes[b + 2]!;
			const maxX = boxes[b + 3]!;
			const maxY = boxes[b + 4]!;
			const maxZ = boxes[b + 5]!;
			for (let p = 0; p < 16; p += 4) {
				const a = planes[p]!;
				const bb = planes[p + 1]!;
				const c = planes[p + 2]!;
				const farthest =
					a * (a > 0 ? maxX : minX) +
					bb * (bb > 0 ? maxY : minY) +
					c * (c > 0 ? maxZ : minZ) +
					planes[p + 3]!;
				if (farthest < 0) continue outer;
			}
			const a = planes[16]!;
			const bb = planes[17]!;
			const c = planes[18]!;
			const depth =
				a * (a > 0 ? minX : maxX) +
				bb * (bb > 0 ? minY : maxY) +
				c * (c > 0 ? minZ : maxZ) +
				planes[19]!;
			if (depth >= nearest) continue;
			nearest = chunks ? Math.min(nearest, chunkDepth(chunks, b / 6, planes)) : depth;
		}
	};

	const measureObject = (object: THREE.Object3D) => {
		const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
		const geometry = renderable.geometry;
		if (!geometry?.getAttribute?.('position')) return;
		sawContent = true;

		if (isPlainTriangleMesh(object)) {
			const chunks = chunksOf(object, geometry);
			testBoxes(chunks.boxes, toLocalPlanes(object.matrixWorld), chunks);
			return;
		}

		// Lines, points, instanced/skinned meshes: one box for the whole object.
		const instanced = object as Partial<THREE.InstancedMesh>;
		if (instanced.isInstancedMesh) {
			if (!instanced.boundingBox) instanced.computeBoundingBox!();
			box.copy(instanced.boundingBox!);
		} else {
			if (!geometry.boundingBox) geometry.computeBoundingBox();
			box.copy(geometry.boundingBox!);
		}
		if (box.isEmpty()) return;
		singleBox[0] = box.min.x;
		singleBox[1] = box.min.y;
		singleBox[2] = box.min.z;
		singleBox[3] = box.max.x;
		singleBox[4] = box.max.y;
		singleBox[5] = box.max.z;
		testBoxes(singleBox, toLocalPlanes(object.matrixWorld));
	};

	// Prunes whole subtrees: hidden objects, viewer aids, and edge overlays (they trace their parent
	// mesh, and their one big box would defeat the parent's chunking).
	const visit = (object: THREE.Object3D) => {
		if (!object.visible || isViewerAidRoot(object)) return;
		if (object.userData.kind === EDGE_USERDATA_KIND) return;
		measureObject(object);
		for (const child of object.children) visit(child);
	};

	const measure = (scene: THREE.Scene, camera: THREE.PerspectiveCamera): number | null => {
		scene.updateMatrixWorld();
		camera.updateMatrixWorld();

		viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		frustum.setFromProjectionMatrix(viewProjection);
		// planes[0..3] are the side planes; [4]/[5] are far/near, which this must ignore — near is
		// what's being solved for, and content past far isn't drawn regardless of near.
		for (let i = 0; i < 4; i++) {
			const plane = frustum.planes[i]!;
			worldPlanes[i * 4] = plane.normal.x;
			worldPlanes[i * 4 + 1] = plane.normal.y;
			worldPlanes[i * 4 + 2] = plane.normal.z;
			worldPlanes[i * 4 + 3] = plane.constant;
		}
		camera.getWorldDirection(forward);
		worldPlanes[16] = forward.x;
		worldPlanes[17] = forward.y;
		worldPlanes[18] = forward.z;
		worldPlanes[19] = -forward.dot(camera.position);

		nearest = Infinity;
		sawContent = false;
		for (const child of scene.children) visit(child);
		return sawContent ? nearest : null;
	};

	return { measure };
}

function isPlainTriangleMesh(object: THREE.Object3D): boolean {
	const mesh = object as Partial<THREE.Mesh & THREE.InstancedMesh & THREE.SkinnedMesh>;
	if (!mesh.isMesh || mesh.isInstancedMesh || mesh.isSkinnedMesh) return false;
	const geometry = mesh.geometry as THREE.BufferGeometry & { isInstancedBufferGeometry?: boolean };
	// Line2's `position` is a template quad; its points live in instance attributes, which only
	// the geometry's own computeBoundingBox reads.
	if (geometry.isInstancedBufferGeometry) return false;
	return Object.keys(geometry.morphAttributes).length === 0;
}

function versionOf(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): number {
	return (attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute
		? (attribute as THREE.InterleavedBufferAttribute).data.version
		: (attribute as THREE.BufferAttribute).version;
}

/**
 * Triangle offsets where a merged mesh's source objects begin. A chunk spanning two of them would
 * box the empty space between, and a camera parked in that space would read as touching geometry.
 */
function memberStarts(object: THREE.Object3D): number[] {
	const starts: number[] = [];
	for (const member of membersOf(object) ?? []) {
		if (member.indexStart !== undefined) starts.push(member.indexStart / 3);
	}
	return starts.sort((a, b) => a - b);
}

/**
 * Bounds of consecutive runs of triangles, never crossing a `breaks` offset. Grouped by triangle,
 * not by vertex, so each box holds whole triangles: a big face whose corners all sit off-screen
 * still overlaps the frustum.
 */
function buildChunkBoxes(
	position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
	index: THREE.BufferAttribute | null,
	breaks: number[]
): Chunks {
	const triangleCount = Math.floor((index ? index.count : position.count) / 3);
	const ranges: number[] = [];
	let nextBreak = 0;
	for (let start = 0; start < triangleCount;) {
		while (nextBreak < breaks.length && breaks[nextBreak]! <= start) nextBreak++;
		const end = Math.min(
			triangleCount,
			start + TRIANGLES_PER_CHUNK,
			breaks[nextBreak] ?? triangleCount
		);
		ranges.push(start, end);
		start = end;
	}
	const chunkCount = ranges.length / 2;
	const boxes = new Float32Array(chunkCount * 6);
	const plain = !(position as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute;
	const array = position.array as ArrayLike<number>;
	const fast = plain && position.itemSize === 3 && !position.normalized;
	const indices = index?.array as ArrayLike<number> | undefined;

	for (let chunk = 0; chunk < chunkCount; chunk++) {
		let minX = Infinity;
		let minY = Infinity;
		let minZ = Infinity;
		let maxX = -Infinity;
		let maxY = -Infinity;
		let maxZ = -Infinity;
		const end = ranges[chunk * 2 + 1]! * 3;
		for (let corner = ranges[chunk * 2]! * 3; corner < end; corner++) {
			const v = indices ? indices[corner]! : corner;
			const x = fast ? array[v * 3]! : position.getX(v);
			const y = fast ? array[v * 3 + 1]! : position.getY(v);
			const z = fast ? array[v * 3 + 2]! : position.getZ(v);
			if (x < minX) minX = x;
			if (y < minY) minY = y;
			if (z < minZ) minZ = z;
			if (x > maxX) maxX = x;
			if (y > maxY) maxY = y;
			if (z > maxZ) maxZ = z;
		}
		const o = chunk * 6;
		boxes[o] = minX;
		boxes[o + 1] = minY;
		boxes[o + 2] = minZ;
		boxes[o + 3] = maxX;
		boxes[o + 4] = maxY;
		boxes[o + 5] = maxZ;
	}
	return { boxes, ranges: Uint32Array.from(ranges) };
}
