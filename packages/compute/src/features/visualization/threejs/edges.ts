import * as THREE from 'three';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

/**
 * Crisp boundary/crease edges overlaid on meshes — the defining "technical drawing" look that makes
 * shaded geometry read as discrete objects rather than blobs.
 *
 * Built with `EdgesGeometry` (which keeps only edges whose adjacent faces meet above a threshold
 * angle, so flat tessellation noise is dropped) rendered as a fat `LineSegments2` using the same
 * `LineMaterial` family as curves (Phase 1) — so edges get controllable thickness, not the 1px cap
 * of `THREE.LineSegments`. The overlay is added as a *child* of each mesh, so it inherits the mesh's
 * transform and is disposed when the mesh subtree is cleared.
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
}

/** Tag on edge overlays so pick/fit/clear logic can recognize and skip or dispose them. */
export const EDGE_USERDATA_KIND = 'edge-overlay';

const DEFAULT_EDGE_COLOR = 0x222222;
const DEFAULT_EDGE_WIDTH = 1.5;
const DEFAULT_THRESHOLD_ANGLE = 44;
const DEFAULT_DARKEN = 0.75;

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
}
const edgeGeometryCache = new WeakMap<THREE.BufferGeometry, Map<number, EdgeGeometryEntry>>();

/** Where an overlay's (possibly shared) line geometry came from, for refcounted disposal. */
interface EdgeOverlayUserData {
	kind: string;
	edgeSource?: THREE.BufferGeometry;
	edgeThresholdAngle?: number;
}

/**
 * Walk an object subtree and attach an edge overlay to every `Mesh` found, returning the created
 * overlays (so callers can dispose them explicitly if they don't clear the whole subtree). Meshes
 * that already carry an overlay are skipped, so this is safe to call more than once.
 *
 * Skips the floor and the grid (they're aids, not content) and anything already tagged as an edge.
 */
export function addEdges(root: THREE.Object3D, options: EdgeOptions = {}): LineSegments2[] {
	const forcedColor = options.color != null ? new THREE.Color(options.color) : null;
	const darken = THREE.MathUtils.clamp(options.darken ?? DEFAULT_DARKEN, 0, 1);
	const width = options.width ?? DEFAULT_EDGE_WIDTH;
	const thresholdAngle = options.thresholdAngle ?? DEFAULT_THRESHOLD_ANGLE;
	const distanceFade = options.distanceFade ?? true;

	// Overlays sharing a color share a material: with a forced color that's one material for the whole
	// call; when deriving per-mesh, meshes of the same surface color (instanced/repeated parts) still
	// collapse onto one. Keyed by the resulting hex so we build each distinct color's uniforms once.
	const materialsByColor = new Map<number, LineMaterial>();
	const materialFor = (mesh: THREE.Mesh): LineMaterial => {
		const color = forcedColor ?? deriveEdgeColor(mesh, darken);
		const key = color.getHex();
		let material = materialsByColor.get(key);
		if (!material) {
			material = createEdgeMaterial(color, width, distanceFade);
			materialsByColor.set(key, material);
		}
		return material;
	};

	const created: LineSegments2[] = [];

	root.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		if (object.userData.id === 'floor' || object.userData.id === 'grid') return;
		if (object.userData.kind === EDGE_USERDATA_KIND) return;
		if (object.children.some((c) => c.userData?.kind === EDGE_USERDATA_KIND)) return; // already done
		if (!object.geometry) return;

		const overlay = buildEdgeOverlay(
			object.geometry,
			materialFor(object),
			thresholdAngle,
			distanceFade
		);
		object.add(overlay); // child → inherits transform, disposed with the parent subtree
		setSurfaceDepthOffset(object, true); // surface recedes a hair so the true-depth edges win
		created.push(overlay);
	});

	// Dispose any material no overlay adopted (e.g. all meshes were skipped, so nothing referenced it).
	if (created.length === 0) materialsByColor.forEach((material) => material.dispose());

	return created;
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

/** Get (or extract and cache) the shared edge line geometry for a source geometry + crease angle. */
function acquireEdgeGeometry(
	geometry: THREE.BufferGeometry,
	thresholdAngle: number
): LineSegmentsGeometry {
	let byAngle = edgeGeometryCache.get(geometry);
	if (!byAngle) {
		byAngle = new Map();
		edgeGeometryCache.set(geometry, byAngle);
	}

	let entry = byAngle.get(thresholdAngle);
	if (!entry) {
		const edges = new THREE.EdgesGeometry(geometry, thresholdAngle);

		// EdgesGeometry yields a Float32Array of line-segment endpoint pairs; LineSegmentsGeometry
		// consumes it as-is (round-tripping through Array.from would box every vertex into a JS array
		// only for setPositions to convert it straight back).
		const lineGeometry = new LineSegmentsGeometry();
		lineGeometry.setPositions(edges.attributes.position.array as Float32Array);
		edges.dispose(); // frees only GPU-side state; the CPU array now backs the line geometry

		entry = { geometry: lineGeometry, refCount: 0 };
		byAngle.set(thresholdAngle, entry);
	}

	entry.refCount += 1;
	return entry.geometry;
}

/** Refcounted inverse of {@link acquireEdgeGeometry}: dispose only when the last overlay is gone. */
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
	geometry: THREE.BufferGeometry,
	material: LineMaterial,
	thresholdAngle: number,
	distanceFade: boolean
): LineSegments2 {
	const lineGeometry = acquireEdgeGeometry(geometry, thresholdAngle);

	const overlay = new LineSegments2(lineGeometry, material);
	overlay.userData.kind = EDGE_USERDATA_KIND;
	// Remember which cache entry backs this overlay so removeEdges can refcount its disposal. The
	// strong reference is fine: the overlay is a child of the mesh that owns the source geometry,
	// so their lifetimes already coincide.
	overlay.userData.edgeSource = geometry;
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

/** Whether an object is an edge overlay (for pick/fit filters elsewhere). */
export function isEdgeOverlay(object: THREE.Object3D): boolean {
	return object.userData?.kind === EDGE_USERDATA_KIND;
}

/**
 * Remove every edge overlay under `root`, disposing its geometry and material. The inverse of
 * {@link addEdges}; together they make edges a live on/off toggle. Returns how many were removed.
 */
export function removeEdges(root: THREE.Object3D): number {
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
