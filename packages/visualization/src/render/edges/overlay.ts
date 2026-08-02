import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

import type { EdgeGeometryEntry } from './line-geometry.js';
import {
	DEFAULT_EDGE_COLOR,
	EDGE_OFFSET_FACTOR,
	EDGE_OFFSET_UNITS,
	EDGE_USERDATA_KIND,
	FADE_END_PX,
	FADE_START_PX,
	type ResolvedOptions
} from './options.js';

// ============================================================================
// Overlay construction
// ============================================================================

// Multiplicative darkening (not lerp-to-black) preserves hue and desaturates gently; a near-black
// surface just yields near-black edges.
function deriveEdgeColor(mesh: THREE.Mesh, darken: number): THREE.Color {
	const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
	const source = (material as { color?: THREE.Color } | null)?.color;
	if (!source) return new THREE.Color(DEFAULT_EDGE_COLOR);
	return source.clone().multiplyScalar(1 - darken);
}

/** Pools materials by color+fade so overlays sharing both share one `LineMaterial` instance. */
export class MaterialPool {
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
	// Lifts lines toward the camera by a couple of depth-quantization steps so they win z-fighting
	// against the surface they were extracted from, without moving the surface itself.
	material.polygonOffset = true;
	material.polygonOffsetFactor = EDGE_OFFSET_FACTOR;
	material.polygonOffsetUnits = EDGE_OFFSET_UNITS;
	// Set once here, not per draw: flipping `transparent` after the render list is built wouldn't
	// re-sort the object into the transparent pass.
	if (distanceFade) material.transparent = true;
	return material;
}

export function buildEdgeOverlay(
	entry: EdgeGeometryEntry,
	material: LineMaterial,
	distanceFade: boolean
): LineSegments2 {
	const overlay = new LineSegments2(entry.geometry, material);
	overlay.userData.kind = EDGE_USERDATA_KIND;
	overlay.raycast = () => {}; // never pickable; clicks should hit the mesh, not its outline
	if (distanceFade) enableDistanceFade(overlay, entry.edgeSpacing);
	return overlay;
}

const _fadeCenter = new THREE.Vector3();
const _fadeCameraPos = new THREE.Vector3();

// Returns Infinity ("don't fade") for an unknown/degenerate projection, or a camera inside the mesh.
function pixelsPerWorldUnit(
	overlay: LineSegments2,
	camera: THREE.Camera,
	viewportHeightPx: number
): number {
	if (!overlay.geometry.boundingSphere) overlay.geometry.computeBoundingSphere();
	const sphere = overlay.geometry.boundingSphere;
	if (!sphere) return Infinity;

	if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
		const perspective = camera as THREE.PerspectiveCamera;
		_fadeCenter.copy(sphere.center).applyMatrix4(overlay.matrixWorld);
		const distance = _fadeCameraPos
			.setFromMatrixPosition(camera.matrixWorld)
			.distanceTo(_fadeCenter);
		const radius = sphere.radius * overlay.matrixWorld.getMaxScaleOnAxis();
		if (distance <= radius) return Infinity; // camera inside the mesh — no fade
		const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(perspective.fov) * 0.5);
		const worldHeightAtCentre = 2 * distance * tanHalfFov;
		return worldHeightAtCentre > 0 ? viewportHeightPx / worldHeightAtCentre : Infinity;
	}
	if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
		const ortho = camera as THREE.OrthographicCamera;
		const worldHeight = (ortho.top - ortho.bottom) / ortho.zoom;
		return worldHeight > 0 ? viewportHeightPx / worldHeight : Infinity;
	}
	return Infinity;
}

// Runs in onBeforeRender (not computed once) so opacity is written right before this overlay's
// draw call — uniforms upload per draw, so overlays sharing one material still fade independently.
// Chains LineSegments2's own onBeforeRender to keep its resolution uniform in sync.
function enableDistanceFade(overlay: LineSegments2, edgeSpacing: number): void {
	// Assign via the Object3D base type: LineSegments2's typings narrow onBeforeRender to
	// (renderer) only, but the renderer actually calls it with (renderer, scene, camera, …).
	(overlay as THREE.Object3D).onBeforeRender = (renderer, _scene, camera) => {
		LineSegments2.prototype.onBeforeRender.call(overlay, renderer);
		const material = overlay.material as LineMaterial;
		const scale = pixelsPerWorldUnit(overlay, camera, material.resolution.y);
		// Screen-space gap between neighbouring edges. Infinity in, Infinity out — clamps to fully
		// opaque rather than fading on a guess.
		const gapPx = edgeSpacing * scale;
		material.opacity = THREE.MathUtils.clamp(
			(gapPx - FADE_END_PX) / (FADE_START_PX - FADE_END_PX),
			0,
			1
		);
	};
}
