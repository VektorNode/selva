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
 *
 * Split out of `init-three.ts` because the annotation is ~90 lines of documented surface — inline it
 * pushed the factory's actual wiring past line 120, which is the part a reader is looking for.
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
	 * Attach edge overlays to the meshes under `root` (no-op unless `edges.enabled`). Call after
	 * loading meshes via `updateScene`, since meshes arrive after init. Extraction for large meshes
	 * runs off-thread — their overlays attach a beat later; meshes over `edges.maxTriangles` are
	 * skipped and (by default) covered by the screen-space edge fallback instead.
	 */
	applyEdges: (root: THREE.Object3D) => void;
	/**
	 * Remove edge overlays under `root` — the toggle-off counterpart of `applyEdges`. Prefer this
	 * over calling `removeEdges` directly: it also cancels in-flight async attaches' fallout and
	 * stands down the screen-space edge fallback if it was active.
	 */
	clearEdges: (root: THREE.Object3D) => void;
	/**
	 * Request a repaint from the on-demand render loop. Camera motion, resizes, pointer input, and
	 * the built-in setters invalidate automatically; call this after mutating the scene externally
	 * (e.g. `updateScene`, adding user geometry) so the change shows immediately rather than on the
	 * next safety repaint. No-op (harmless) when `render.onDemand` is false.
	 */
	invalidate: () => void;
	/** Toggle ambient occlusion at runtime — builds or tears down the postprocessing pipeline. */
	setAmbientOcclusion: (enabled: boolean) => void;
	/**
	 * Switch the viewer to a ready-to-go look at runtime ('studio' | 'technical' | 'showcase'). Retunes
	 * lighting/material only (tone mapping, fill, IBL, AO) — never edges/grid. A straight preset apply:
	 * overwrites any granular lighting dials you set earlier.
	 */
	setLook: (look: 'studio' | 'technical' | 'showcase') => void;
	/**
	 * Retune the fill lights at runtime: the direction-aware hemisphere fill (sky/ground) and the flat
	 * ambient. Raising `hemisphereIntensity` is the most effective way to lift shadowed / under-facing
	 * surfaces a dark HDR leaves black. A positive `hemisphereIntensity` lazily creates the hemisphere
	 * light if the viewer was built without one; `0` switches it off.
	 */
	setFillLights: (opts: {
		hemisphereIntensity?: number;
		hemisphereSkyColor?: THREE.Color | number;
		hemisphereGroundColor?: THREE.Color | number;
		ambientIntensity?: number;
	}) => void;
	/**
	 * Set the uniform multiplier on the HDR's image-based lighting (`scene.environmentIntensity`) at
	 * runtime — normalizes brightness across HDRs of differing exposure so the scene isn't at the
	 * mercy of whichever HDR is loaded. Applies immediately, even before the HDR finishes decoding.
	 */
	setEnvironmentIntensity: (intensity: number) => void;
	/** Set renderer tone-mapping exposure at runtime. Higher lifts shadows and overall brightness. */
	setToneMappingExposure: (exposure: number) => void;
	/** Set GTAO strength at runtime (0–1). No-op when ambient occlusion isn't active. */
	setAoIntensity: (intensity: number) => void;
	/**
	 * The parse-time material options (backface culling, IBL strength) matching the active look — feed
	 * into the batch parser's `material` option so freshly-loaded meshes are built to match it. See
	 * `setLook`.
	 */
	getMaterialAppearance: () => MaterialAppearanceOptions;
	/**
	 * Refit the sun's shadow frustum to the current scene content for crisp shadows. Call after
	 * loading or replacing geometry (e.g. after `updateScene`). No-op when sunlight/shadows are off.
	 */
	updateShadowBounds: () => void;
	/**
	 * Rescale the grid's cell spacing and fade radius to the current scene content, so parts of any
	 * size get readable cells and a fade that reaches past the model. Call after loading or replacing
	 * geometry (e.g. after `updateScene`). No-op when the grid is off or there's no content.
	 */
	updateGridScale: () => void;
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
	/**
	 * Add caller-owned geometry (lines, annotations, construction aids) to the scene. The object is
	 * tagged `userData.source = 'user'` so it persists across `updateScene` solves instead of being
	 * cleared with compute content. It is treated as normal content for fit-to-view framing.
	 */
	addUserGeometry: (object: THREE.Object3D) => void;
	/** Remove a single user-added object and dispose its geometry/materials. */
	removeUserGeometry: (object: THREE.Object3D) => void;
	/** Remove and dispose all user-added geometry (every object tagged `source === 'user'`). */
	clearUserGeometry: () => void;
}
