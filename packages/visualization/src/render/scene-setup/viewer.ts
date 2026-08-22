import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import type { CameraController } from '../camera-controller.js';
import type { Grid } from '../grid.js';
import type { LabelLayer } from '../label-layer.js';
import type { MeasureTool } from '../measure.js';
import type { ToolRegistry } from '../tool-registry.js';
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
	/** Null unless `measure.enabled`. */
	measureTool: MeasureTool | null;
	/** CSS2D annotation overlay. Always present — labels render above the canvas and don't take input. */
	labelLayer: LabelLayer;
	/**
	 * Pointer tools competing for canvas clicks, ahead of object selection. Built-ins are already
	 * registered as `'measure'` and `'gizmo'`; register your own and drive it with `setActive`.
	 */
	tools: ToolRegistry;
	/**
	 * No-op unless `edges.enabled`. Extraction runs off-thread for large meshes, so overlays can
	 * attach a beat later; meshes over `edges.maxTriangles` fall back to the screen-space edge shader.
	 */
	applyEdges: (root: THREE.Object3D) => void;
	/**
	 * Prefer over `removeEdges` directly — also cancels in-flight async attaches and stands down the
	 * screen-space edge fallback if active.
	 */
	clearEdges: (root: THREE.Object3D) => void;
	/**
	 * Request a repaint from the on-demand render loop. Built-in setters and input invalidate
	 * automatically; call this after mutating the scene externally. No-op when `render.onDemand` is false.
	 */
	invalidate: () => void;
	/**
	 * PNG (or `type`) snapshot of the current view. Use this rather than reading the canvas directly —
	 * it forces a synchronous draw first, which a plain `toBlob` on a `preserveDrawingBuffer: false`
	 * context cannot do, and would hand back a blank image.
	 */
	captureImage: (type?: string, quality?: number) => Promise<Blob | null>;
	setAmbientOcclusion: (enabled: boolean) => void;
	/**
	 * Retunes lighting/material (tone mapping, fill, IBL, AO) only — never edges/grid. Overwrites
	 * any granular lighting dials set earlier with the preset's values.
	 */
	setLook: (look: 'studio' | 'technical' | 'showcase') => void;
	/**
	 * Raising `hemisphereIntensity` is the most effective way to lift shadowed surfaces a dark HDR
	 * leaves black. Lazily creates the hemisphere light if the viewer was built without one; `0` turns
	 * it back off.
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
	 * Adds host-owned geometry that survives `updateScene` solves and counts for fit-to-view.
	 * Pass `appId` to scope it to one app (`userData.source = 'app:<id>'`) so `clearUserGeometry`
	 * can clear that app alone; without one it's tagged `'user'` and only a global clear removes it.
	 *
	 * Not restyled by `setLook` — the caller owns these materials.
	 */
	addUserGeometry: (object: THREE.Object3D, appId?: string) => void;
	removeUserGeometry: (object: THREE.Object3D) => void;
	/** Removes and disposes geometry added via `addUserGeometry` — one app's, or all of it. */
	clearUserGeometry: (appId?: string) => void;
}
