// Loaded by `captureSolve` in a headless browser, never by an MCP client: it draws one
// Rhino.Compute response and hands back a PNG per camera through `window.selvaCapture`.

import * as THREE from 'three';
import {
	getThreeObjectsFromComputeResponse,
	setTextureAnisotropy
} from '@selvajs/visualization/parse';
import {
	initThree,
	LOOKS,
	updateScene,
	type Look,
	type ThreeViewer,
	type ViewPreset
} from '@selvajs/visualization/render';

export interface CaptureCameraRequest {
	view?: ViewPreset;
	/** Degrees around the up axis: 0 looks from the front, 90 from the right. Overrides `view`. */
	azimuth?: number;
	/** Degrees above the horizon. Default 30 when `azimuth` is set. */
	elevation?: number;
	/** 1 fits the geometry; 2 is twice as close. */
	zoom?: number;
	/** World point to look at, in model units. Default the middle of what is drawn. */
	target?: [number, number, number];
	label?: string;
}

export interface CaptureRequest {
	response: unknown;
	cameras: CaptureCameraRequest[];
	grid: boolean;
	look?: string;
	background?: string;
	/** An HDR environment's URL; `data:` works. Without one the viewer generates its lighting. */
	hdr?: string;
	/** Layers or object names to leave out; a layer hides its sublayers (`Room` hides `Room/Walls`). */
	hide?: string[];
	/** Per camera, leave out walls standing between the camera and the middle of the scene. */
	cutaway?: boolean;
	/** Fit the camera tightly to what is drawn. False keeps the viewer's looser framing. */
	frame?: boolean;
	/** One picture with every camera in a grid, instead of one per camera. */
	sheet?: boolean;
}

export interface CaptureImage {
	/** Base64 PNG, no `data:` prefix. */
	png: string;
	label: string;
	/** Layers or names the cutaway left out for this camera. */
	cut: string[];
}

export interface CaptureResult {
	/** One per camera, or a single contact sheet. Empty when nothing was drawn. */
	images: CaptureImage[];
	drawn: number;
	/** Every layer drawn, for `hide`. */
	layers: string[];
}

declare global {
	interface Window {
		selvaCapture(request: CaptureRequest): Promise<CaptureResult>;
	}
}

const ENVIRONMENT_WAIT_MS = 10_000;
// Share of the frame the geometry may fill, so it never touches the edge.
const FILL = 0.92;
// A wall for the cutaway: at least this share of the scene's height, and its thin side at most this
// share of its long side.
const WALL_HEIGHT = 0.6;
const WALL_THINNESS = 0.15;

const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

// ============================================================================
// Parts: what can be hidden
// ============================================================================

interface Member {
	indexStart: number;
	indexCount: number;
	layer?: string;
	name?: string;
}

/** A mesh, or one source object merged into it. */
interface Part {
	mesh: THREE.Mesh;
	member?: Member;
	layer: string;
	name: string;
	box: THREE.Box3;
}

function collectParts(roots: THREE.Object3D[]): Part[] {
	const parts: Part[] = [];
	const point = new THREE.Vector3();
	for (const root of roots) {
		root.updateMatrixWorld(true);
		root.traverse((object) => {
			const mesh = object as THREE.Mesh;
			if (!mesh.isMesh || !mesh.geometry) return;
			const data = mesh.userData as { layer?: string; name?: string; members?: Member[] };
			const index = mesh.geometry.index;
			const position = mesh.geometry.getAttribute('position');
			if (data.members?.length && index && position) {
				for (const member of data.members) {
					const box = new THREE.Box3();
					for (let i = member.indexStart; i < member.indexStart + member.indexCount; i++) {
						box.expandByPoint(point.fromBufferAttribute(position, index.getX(i)));
					}
					box.applyMatrix4(mesh.matrixWorld);
					parts.push({
						mesh,
						member,
						layer: member.layer ?? data.layer ?? '',
						name: member.name ?? '',
						box
					});
				}
				return;
			}
			parts.push({
				mesh,
				layer: data.layer ?? '',
				name: data.name ?? mesh.name,
				box: new THREE.Box3().setFromObject(mesh)
			});
		});
	}
	return parts;
}

function matchesHide(part: Part, hide: string[]): boolean {
	const layer = part.layer.toLowerCase();
	const name = part.name.toLowerCase();
	return hide.some((h) => {
		const key = h.trim().toLowerCase();
		if (!key) return false;
		return (
			layer === key || layer.startsWith(`${key}/`) || layer.startsWith(`${key}::`) || name === key
		);
	});
}

/** Tall, thin, upright parts on the camera's side of the scene, facing it. */
function wallsFacing(parts: Part[], toCamera: THREE.Vector3, up: THREE.Vector3): Part[] {
	const scene = new THREE.Box3();
	for (const p of parts) scene.union(p.box);
	if (scene.isEmpty()) return [];
	const centre = scene.getCenter(new THREE.Vector3());
	const sceneHeight = Math.abs(scene.getSize(new THREE.Vector3()).dot(up));
	const flat = (v: THREE.Vector3) => v.clone().sub(up.clone().multiplyScalar(v.dot(up)));
	const look = flat(toCamera);
	if (look.lengthSq() < 1e-9) return []; // straight down: no wall stands in the way
	look.normalize();

	return parts.filter((p) => {
		const size = p.box.getSize(new THREE.Vector3());
		if (Math.abs(size.dot(up)) < WALL_HEIGHT * sceneHeight) return false;
		const horizontal = flat(size);
		const extents = [Math.abs(horizontal.x), Math.abs(horizontal.y), Math.abs(horizontal.z)];
		const axes = [
			new THREE.Vector3(1, 0, 0),
			new THREE.Vector3(0, 1, 0),
			new THREE.Vector3(0, 0, 1)
		];
		// The up axis has no horizontal extent: drop it before comparing.
		const pairs = extents
			.map((e, i) => ({ e, axis: axes[i]! }))
			.filter(({ axis }) => Math.abs(axis.dot(up)) < 0.5)
			.sort((a, b) => a.e - b.e);
		if (pairs.length < 2) return false;
		const [thin, long] = [pairs[0]!, pairs[pairs.length - 1]!];
		if (long.e <= 0 || thin.e > WALL_THINNESS * long.e) return false;
		// Edge-on walls hide nothing.
		if (Math.abs(thin.axis.dot(look)) < 0.3) return false;
		const offset = flat(p.box.getCenter(new THREE.Vector3()).sub(centre));
		return offset.dot(look) > 0;
	});
}

// ============================================================================
// Hiding parts for one camera
// ============================================================================

/**
 * Hides parts and returns how to undo it. A mesh losing some merged members is swapped for a copy
 * without them: the original keeps its cached geometry and its edges, which would still draw the
 * hidden members' outlines.
 */
function hideParts(scene: THREE.Scene, all: Part[], hidden: Set<Part>): () => void {
	const undo: (() => void)[] = [];
	const byMesh = new Map<THREE.Mesh, Part[]>();
	for (const p of all) byMesh.set(p.mesh, [...(byMesh.get(p.mesh) ?? []), p]);

	for (const [mesh, parts] of byMesh) {
		const gone = parts.filter((p) => hidden.has(p));
		if (!gone.length || !mesh.visible) continue;
		mesh.visible = false;
		undo.push(() => (mesh.visible = true));
		const kept = parts.filter((p) => !hidden.has(p) && p.member);
		const index = mesh.geometry.index;
		if (!kept.length || !index) continue;

		const indices: number[] = [];
		for (const { member } of kept) {
			for (let i = member!.indexStart; i < member!.indexStart + member!.indexCount; i++) {
				indices.push(index.getX(i));
			}
		}
		const geometry = new THREE.BufferGeometry();
		for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
			geometry.setAttribute(name, attribute);
		}
		geometry.setIndex(indices);
		const copy = new THREE.Mesh(geometry, mesh.material);
		copy.castShadow = mesh.castShadow;
		copy.receiveShadow = mesh.receiveShadow;
		copy.userData = mesh.userData;
		mesh.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
		scene.add(copy);
		// Not disposed: its attributes are the original's, and disposing would free them on the GPU.
		undo.push(() => scene.remove(copy));
	}
	return () => undo.forEach((u) => u());
}

// ============================================================================
// Camera
// ============================================================================

interface Basis {
	front: THREE.Vector3;
	right: THREE.Vector3;
	up: THREE.Vector3;
}

/** The viewer's own front, right and up, so azimuth 0 matches its Front preset. */
function basisOf(viewer: ThreeViewer): Basis {
	const direction = (preset: ViewPreset) => {
		viewer.cameraController.setView(preset, false);
		return viewer.camera.position.clone().sub(viewer.controls.target).normalize();
	};
	return {
		front: direction('front'),
		right: direction('right'),
		up: viewer.camera.up.clone().normalize()
	};
}

function directionOf(camera: CaptureCameraRequest, basis: Basis, viewer: ThreeViewer) {
	if (camera.azimuth === undefined && camera.elevation === undefined) {
		viewer.cameraController.setView(camera.view ?? 'iso', false);
		return viewer.camera.position.clone().sub(viewer.controls.target).normalize();
	}
	const rad = Math.PI / 180;
	const az = (camera.azimuth ?? 40) * rad;
	// Not the pole itself: looking straight down `up` leaves the camera's roll undefined.
	const el = Math.max(-89.5, Math.min(89.5, camera.elevation ?? 30)) * rad;
	return basis.front
		.clone()
		.multiplyScalar(Math.cos(az))
		.add(basis.right.clone().multiplyScalar(Math.sin(az)))
		.multiplyScalar(Math.cos(el))
		.add(basis.up.clone().multiplyScalar(Math.sin(el)))
		.normalize();
}

const cornersOf = (box: THREE.Box3) =>
	[0, 1, 2, 3, 4, 5, 6, 7].map(
		(i) =>
			new THREE.Vector3(
				i & 1 ? box.max.x : box.min.x,
				i & 2 ? box.max.y : box.min.y,
				i & 4 ? box.max.z : box.min.z
			)
	);

/** A camera looking at `target` from `distance` along `direction`, with its matrices current. */
function aim(
	probe: THREE.PerspectiveCamera,
	target: THREE.Vector3,
	direction: THREE.Vector3,
	distance: number
) {
	probe.position.copy(target).addScaledVector(direction, distance);
	probe.lookAt(target);
	probe.updateMatrixWorld(true);
}

/** The nearest distance along `direction` from `target` at which every point is in frame. */
function fitDistance(
	probe: THREE.PerspectiveCamera,
	points: THREE.Vector3[],
	target: THREE.Vector3,
	direction: THREE.Vector3,
	radius: number
): number {
	const tanV = Math.tan((probe.fov * Math.PI) / 360) * FILL;
	const tanH = tanV * probe.aspect;
	const fits = (distance: number) => {
		aim(probe, target, direction, distance);
		return points.every((c) => {
			const p = c.clone().applyMatrix4(probe.matrixWorldInverse);
			const depth = -p.z;
			return depth > probe.near && Math.abs(p.x) <= depth * tanH && Math.abs(p.y) <= depth * tanV;
		});
	};
	let near = 0;
	let far = radius * 4 || 1;
	while (!fits(far)) far *= 2;
	for (let i = 0; i < 40; i++) {
		const mid = (near + far) / 2;
		if (fits(mid)) far = mid;
		else near = mid;
	}
	return far;
}

/**
 * Moves `target` across the view so the points sit in the middle of the frame. An L-shaped plan
 * fills its bounding box's corner only on one side, so the box's centre leaves it off to one side.
 */
function centreOnPoints(
	probe: THREE.PerspectiveCamera,
	points: THREE.Vector3[],
	target: THREE.Vector3,
	direction: THREE.Vector3,
	distance: number
): THREE.Vector3 {
	aim(probe, target, direction, distance);
	let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
	for (const point of points) {
		const p = point.clone().project(probe);
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	// NDC offset to world units at the target's depth.
	const halfV = Math.tan((probe.fov * Math.PI) / 360) * distance;
	const right = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 0);
	const up = new THREE.Vector3().setFromMatrixColumn(probe.matrixWorld, 1);
	return target
		.clone()
		.addScaledVector(right, ((minX + maxX) / 2) * halfV * probe.aspect)
		.addScaledVector(up, ((minY + maxY) / 2) * halfV);
}

function placeCamera(
	viewer: ThreeViewer,
	camera: CaptureCameraRequest,
	direction: THREE.Vector3,
	shown: Part[],
	tight: boolean
): void {
	const box = new THREE.Box3();
	for (const p of shown) box.union(p.box);
	let target = camera.target
		? new THREE.Vector3(...camera.target)
		: box.getCenter(new THREE.Vector3());
	let distance: number;
	if (tight && !box.isEmpty()) {
		const points = shown.flatMap((p) => cornersOf(p.box));
		const radius =
			box.getBoundingSphere(new THREE.Sphere()).radius +
			box.getCenter(new THREE.Vector3()).distanceTo(target);
		const probe = viewer.camera.clone();
		distance = fitDistance(probe, points, target, direction, radius);
		if (!camera.target) {
			// Perspective shifts the middle as the camera moves in: settle it in two passes.
			for (let pass = 0; pass < 2; pass++) {
				target = centreOnPoints(probe, points, target, direction, distance);
				distance = fitDistance(probe, points, target, direction, radius);
			}
		}
	} else {
		viewer.cameraController.setViewDirection(direction, false);
		distance = viewer.camera.position.distanceTo(viewer.controls.target);
	}
	distance /= Math.max(0.05, camera.zoom ?? 1);
	viewer.camera.position.copy(target).addScaledVector(direction, distance);
	viewer.controls.target.copy(target);
	// Far enough for any zoom-out; the near plane stays the viewer's.
	viewer.camera.far = Math.max(viewer.camera.far, distance * 4);
	viewer.camera.updateProjectionMatrix();
	viewer.controls.update();
}

function cameraLabel(camera: CaptureCameraRequest): string {
	if (camera.label) return camera.label;
	if (camera.azimuth === undefined && camera.elevation === undefined) return camera.view ?? 'iso';
	return `azimuth ${camera.azimuth ?? 40}°, elevation ${camera.elevation ?? 30}°`;
}

// ============================================================================
// Pictures
// ============================================================================

async function toBase64(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

async function contactSheet(shots: { blob: Blob; label: string }[]): Promise<Blob | null> {
	const bitmaps = await Promise.all(shots.map((s) => createImageBitmap(s.blob)));
	const { width, height } = bitmaps[0]!;
	const cols = Math.ceil(Math.sqrt(bitmaps.length));
	const rows = Math.ceil(bitmaps.length / cols);
	const canvas = document.createElement('canvas');
	canvas.width = cols * width;
	canvas.height = rows * height;
	const g = canvas.getContext('2d')!;
	g.fillStyle = '#ffffff';
	g.fillRect(0, 0, canvas.width, canvas.height);
	const font = Math.max(14, Math.round(height / 28));
	g.font = `${font}px sans-serif`;
	bitmaps.forEach((bitmap, i) => {
		const x = (i % cols) * width;
		const y = Math.floor(i / cols) * height;
		g.drawImage(bitmap, x, y);
		const label = shots[i]!.label;
		const pad = font / 2;
		g.fillStyle = 'rgba(255,255,255,0.8)';
		g.fillRect(x, y, g.measureText(label).width + pad * 2, font + pad * 2);
		g.fillStyle = '#1e1f22';
		g.fillText(label, x + pad, y + pad + font * 0.85);
		g.strokeStyle = '#d0d0d0';
		g.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
	});
	return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

const partLabel = (p: Part) => p.name || p.layer || 'unnamed';

// One capture per page: the look and environment are fixed when the viewer is made.
window.selvaCapture = async (request) => {
	const { response, grid, look, background, hdr } = request;
	const canvas = document.createElement('canvas');
	canvas.style.cssText = 'display:block;width:100%;height:100%';
	document.getElementById('stage')!.append(canvas);

	let ready!: () => void;
	const environment = new Promise<void>((resolve) => (ready = resolve));
	const viewer = initThree(canvas, {
		// A saved schema can name a look this build lacks, and an unknown look throws.
		look: LOOKS.includes(look as Look) ? (look as Look) : 'technical',
		onMaxAnisotropy: setTextureAnisotropy,
		environment: { hdrPath: hdr ?? false, ...(background && { backgroundColor: background }) },
		events: { enableEventHandlers: false, onReady: () => ready() }
	});

	await Promise.race([environment, new Promise((r) => setTimeout(r, ENVIRONMENT_WAIT_MS))]);
	const objects = await getThreeObjectsFromComputeResponse(response as never, {
		parsing: { material: viewer.getMaterialAppearance() }
	});
	updateScene(viewer.scene, objects, viewer.camera, viewer.controls, false);
	if (!objects.length) return { images: [], drawn: 0, layers: [] };
	viewer.grid?.setVisible(grid);

	const parts = collectParts(objects);
	const layers = [...new Set(parts.map((p) => p.layer).filter(Boolean))].sort();
	const hide = request.hide ?? [];
	const kept = parts.filter((p) => !matchesHide(p, hide));
	const basis = basisOf(viewer);
	const cameras = request.cameras.length ? request.cameras : [{ view: 'iso' as const }];

	const shots: { blob: Blob; label: string; cut: string[] }[] = [];
	for (const camera of cameras) {
		const direction = directionOf(camera, basis, viewer);
		const cut = request.cutaway ? wallsFacing(kept, direction, basis.up) : [];
		const shown = kept.filter((p) => !cut.includes(p));
		const restore = hideParts(
			viewer.scene,
			parts,
			new Set(parts.filter((p) => !shown.includes(p)))
		);
		placeCamera(viewer, camera, direction, shown, request.frame !== false);
		viewer.updateGridScale();
		viewer.updateShadowBounds();
		viewer.syncEmissiveLights();
		// Edges attach off-thread for large meshes; two frames let them land.
		await frame();
		await frame();
		const blob = await viewer.captureImage('image/png');
		restore();
		if (blob) {
			shots.push({ blob, label: cameraLabel(camera), cut: [...new Set(cut.map(partLabel))] });
		}
	}

	if (!shots.length) return { images: [], drawn: objects.length, layers };
	if (request.sheet && shots.length > 1) {
		const sheet = await contactSheet(shots);
		if (sheet) {
			return {
				images: [
					{
						png: await toBase64(sheet),
						label: shots.map((s) => s.label).join(' | '),
						cut: [...new Set(shots.flatMap((s) => s.cut))]
					}
				],
				drawn: objects.length,
				layers
			};
		}
	}
	return {
		images: await Promise.all(
			shots.map(async (s) => ({ png: await toBase64(s.blob), label: s.label, cut: s.cut }))
		),
		drawn: objects.length,
		layers
	};
};
