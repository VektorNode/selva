import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { CameraController } from '../camera-controller.js';
import type { Grid } from '../grid.js';
import type { MeasureTool } from '../measure.js';
import type { MaterialAppearanceOptions } from '../types.js';
import type { ViewGizmo } from '../view-gizmo.js';

export interface ThreeViewer {
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	controls: OrbitControls;
	renderer: THREE.WebGLRenderer;
	cameraController: CameraController;
	grid: Grid | null;
	gizmo: ViewGizmo | null;
	/** Null unless `measure.enabled`; `setEnabled(true)` to use. */
	measureTool: MeasureTool | null;
	/**
	 * Attach edge overlays to meshes under `root` (no-op unless `edges.enabled`). Large-mesh
	 * extraction runs off-thread, so overlays may attach a beat later; meshes over
	 * `edges.maxTriangles` are skipped and (by default) covered by the screen-space edge fallback.
	 */
	applyEdges: (root: THREE.Object3D) => void;
	/**
	 * Prefer over calling `removeEdges` directly — also cancels in-flight async attaches and stands
	 * down the screen-space fallback if active.
	 */
	clearEdges: (root: THREE.Object3D) => void;
	/**
	 * Request a repaint from the on-demand render loop. Built-in setters and input invalidate
	 * automatically; call this after mutating the scene externally. No-op when `render.onDemand` is false.
	 */
	invalidate: () => void;
	setAmbientOcclusion: (enabled: boolean) => void;
	/**
	 * Retunes lighting/material only (tone mapping, fill, IBL, AO) — never edges/grid. Overwrites
	 * any granular lighting dials set earlier.
	 */
	setLook: (look: 'studio' | 'technical' | 'showcase') => void;
	/**
	 * Raising `hemisphereIntensity` is the most effective way to lift shadowed/under-facing surfaces
	 * a dark HDR leaves black; a positive value lazily creates the hemisphere light if the viewer was
	 * built without one, `0` switches it off.
	 */
	setFillLights: (opts: {
		hemisphereIntensity?: number;
		hemisphereSkyColor?: THREE.Color | number;
		hemisphereGroundColor?: THREE.Color | number;
		ambientIntensity?: number;
	}) => void;
	/**
	 * Normalizes IBL brightness across HDRs of differing exposure. Applies even before the HDR
	 * finishes decoding.
	 */
	setEnvironmentIntensity: (intensity: number) => void;
	setToneMappingExposure: (exposure: number) => void;
	/** GTAO strength (0-1). No-op when ambient occlusion isn't active. */
	setAoIntensity: (intensity: number) => void;
	/** Feed into the batch parser's `material` option so freshly-loaded meshes match the active look. */
	getMaterialAppearance: () => MaterialAppearanceOptions;
	/** Call after loading or replacing geometry. No-op when sunlight/shadows are off. */
	updateShadowBounds: () => void;
	/** Call after loading or replacing geometry. No-op when the grid is off or empty. */
	updateGridScale: () => void;
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
	/**
	 * Tagged `userData.source = 'user'` so it survives `updateScene` solves instead of being cleared
	 * with compute content, and counts as normal content for fit-to-view framing.
	 */
	addUserGeometry: (object: THREE.Object3D) => void;
	removeUserGeometry: (object: THREE.Object3D) => void;
	/** Removes and disposes everything added via `addUserGeometry`. */
	clearUserGeometry: () => void;
}
