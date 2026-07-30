import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { CameraController } from '../camera-controller.js';
import type { Grid } from '../grid.js';
import type { MeasureTool } from '../measure.js';
import type { MaterialAppearanceOptions } from '../types.js';
import type { ViewGizmo } from '../view-gizmo.js';

/**
 * The live viewer {@link initThree} returns: the THREE objects it built, the overlays it wired up,
 * and the runtime setters for retuning them without a rebuild.
 */
export interface ThreeViewer {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	renderer: THREE.WebGLRenderer;
	cameraController: CameraController;
	grid: Grid | null;
	gizmo: ViewGizmo | null;
	/** Two-click distance measurement tool. Null unless `measure.enabled`; `setEnabled(true)` to use. */
	measureTool: MeasureTool | null;
	/**
	 * Attach edge overlays to meshes under `root` (no-op unless `edges.enabled`). Call after loading
	 * meshes via `updateScene`. Large-mesh extraction runs off-thread, so overlays may attach a beat
	 * later; meshes over `edges.maxTriangles` are skipped and (by default) covered by the
	 * screen-space edge fallback instead.
	 */
	applyEdges: (root: THREE.Object3D) => void;
	/**
	 * Toggle-off counterpart of `applyEdges`. Prefer over calling `removeEdges` directly — also
	 * cancels in-flight async attaches and stands down the screen-space fallback if active.
	 */
	clearEdges: (root: THREE.Object3D) => void;
	/**
	 * Request a repaint from the on-demand render loop. Built-in setters and input invalidate
	 * automatically; call this after mutating the scene externally so the change shows immediately.
	 * No-op when `render.onDemand` is false.
	 */
	invalidate: () => void;
	/** Toggle ambient occlusion at runtime — builds or tears down the postprocessing pipeline. */
	setAmbientOcclusion: (enabled: boolean) => void;
	/**
	 * Switch to a ready-to-go look at runtime. Retunes lighting/material only (tone mapping, fill,
	 * IBL, AO) — never edges/grid. Overwrites any granular lighting dials set earlier.
	 */
	setLook: (look: 'studio' | 'technical' | 'showcase') => void;
	/**
	 * Retune the fill lights at runtime. Raising `hemisphereIntensity` is the most effective way to
	 * lift shadowed/under-facing surfaces a dark HDR leaves black; a positive value lazily creates
	 * the hemisphere light if the viewer was built without one, `0` switches it off.
	 */
	setFillLights: (opts: {
		hemisphereIntensity?: number;
		hemisphereSkyColor?: THREE.Color | number;
		hemisphereGroundColor?: THREE.Color | number;
		ambientIntensity?: number;
	}) => void;
	/**
	 * Multiplier on the HDR's image-based lighting (`scene.environmentIntensity`) — normalizes
	 * brightness across HDRs of differing exposure. Applies immediately, even before the HDR
	 * finishes decoding.
	 */
	setEnvironmentIntensity: (intensity: number) => void;
	/** Set renderer tone-mapping exposure at runtime. Higher lifts shadows and overall brightness. */
	setToneMappingExposure: (exposure: number) => void;
	/** Set GTAO strength at runtime (0–1). No-op when ambient occlusion isn't active. */
	setAoIntensity: (intensity: number) => void;
	/**
	 * Parse-time material options (backface culling, IBL strength) matching the active look — feed
	 * into the batch parser's `material` option so freshly-loaded meshes match it. See `setLook`.
	 */
	getMaterialAppearance: () => MaterialAppearanceOptions;
	/**
	 * Refit the sun's shadow frustum to current scene content. Call after loading or replacing
	 * geometry (e.g. after `updateScene`). No-op when sunlight/shadows are off.
	 */
	updateShadowBounds: () => void;
	/**
	 * Rescale the grid's cell spacing and fade radius to current scene content. Call after loading
	 * or replacing geometry (e.g. after `updateScene`). No-op when the grid is off or empty.
	 */
	updateGridScale: () => void;
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
	/**
	 * Add caller-owned geometry (lines, annotations, construction aids) to the scene. Tagged
	 * `userData.source = 'user'` so it survives `updateScene` solves instead of being cleared with
	 * compute content, and counts as normal content for fit-to-view framing.
	 */
	addUserGeometry: (object: THREE.Object3D) => void;
	/** Remove a single user-added object and dispose its geometry/materials. */
	removeUserGeometry: (object: THREE.Object3D) => void;
	/** Remove and dispose all user-added geometry (every object tagged `source === 'user'`). */
	clearUserGeometry: () => void;
}
