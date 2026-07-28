import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

import { getLogger } from '@/core';
import type { ThreeInitializerOptions, Look, LookPreset } from '../types';
import type { MaterialAppearanceOptions } from '../webdisplay/types';
import { createCameraController, type CameraController } from './camera-controller';
import { createGrid, type Grid } from './grid';
import { createViewGizmo, type ViewGizmo } from './view-gizmo';
import { EDGES_SKIPPED_TRIANGLE_CAP, addEdgesAsync, removeEdges } from './edges';
import { createNearPlaneFitter, type NearPlaneFitter } from './near-plane';
import { createRenderPipeline, type RenderPipeline } from './render-pipeline';
import { createLabelLayer, type LabelLayer } from './label-layer';
import { createMeasureTool, type MeasureTool } from './measure';
import { computeContentBounds } from './three-helpers';
import { environmentRotationFor, isoOffset, sunOffset, upToAxis } from './up-axis';
import { setTextureAnisotropy } from '../webdisplay/texture-cache';

/** Rhino's convention, and the frame all geometry arrives in — see `coordinate-transform.ts`. */
const defaultUp = new THREE.Vector3(0, 0, 1);

/** The look applied when the caller passes no `look` option. */
const DEFAULT_LOOK: Look = 'technical';

/**
 * The ready-to-go looks, as concrete lighting/material dial values. Single source of truth: consumed
 * by `applyDefaults` to seed construction-time defaults AND by `setLook` to re-apply a look at
 * runtime, so the two paths can never drift. A look carries ONLY lighting/material — never edges or
 * grid (those are independent overlays). See {@link Look} for what each reads like.
 *
 * Every look ships with `ambientOcclusion: false`: GTAO is a heavy full-screen postprocessing path
 * that can dominate frame time, so it stays opt-in (via `render.ambientOcclusion` or the runtime
 * `setAmbientOcclusion(true)`) rather than costing every viewer 60fps by default.
 */
export const LOOK_PRESETS: Record<Look, LookPreset> = {
	// Soft, even product shot: ACES with generous, balanced fill (hemisphere + a little flat ambient)
	// so the whole object stays legible and shadows read open — the safe, neutral default. IBL and fill
	// are kept modest so their contributions don't triple-stack (env + hemisphere + ambient) and push
	// midtones toward white — ACES then desaturates that lift, which reads as "washed out". Distinct
	// from `showcase`: this fills the shadows in; showcase deliberately lets them fall off for drama.
	studio: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 1.0,
		environmentIntensity: 1.0,
		hemisphereIntensity: 0.75,
		ambientIntensity: 0.4,
		cullBackfaces: false,
		ambientOcclusion: false
	},
	// Clean shaded CAD look: neutral tone mapping, IBL-led so the object keeps FORM. The old dial
	// (ambient 1 + IBL 0.5) was the classic PBR wash — a full flat ambient adds the same value to
	// every face regardless of orientation, flattening shading toward a milky grey, while the one
	// light that actually shapes the surface (the HDR env) was cut to half. Rebalanced per the
	// community rule "let the env map carry the fill, keep flat ambient low": IBL back up to near
	// full, a little direction-aware hemisphere fill to lift under-facing surfaces (what ambient was
	// really being used for), and flat ambient dropped to a thin floor so nothing goes pure black.
	// Still a flat, even, edge-friendly read — just with shape and a hint of material response back.
	technical: {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 0.9,
		environmentIntensity: 1,
		hemisphereIntensity: 0.35,
		ambientIntensity: 0.25,
		cullBackfaces: false,
		ambientOcclusion: false
	},
	// Dramatic hero shot: pushes exposure and reflective IBL for glossy pop, but deliberately pulls the
	// flat fill DOWN (low ambient, lean hemisphere) so light-to-shadow falloff stays strong and form
	// reads with contrast. Where `studio` fills the shadows in for even legibility, showcase lets them
	// fall off. Still trimmed below the old triple-stacked values so the punch doesn't tip into the
	// ACES wash — the drama comes from higher exposure + IBL against lower fill, not from stacking lift.
	showcase: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1.15,
		envMapIntensity: 1.4,
		environmentIntensity: 1.25,
		hemisphereIntensity: 0.35,
		ambientIntensity: 0.15,
		cullBackfaces: false,
		ambientOcclusion: false
	}
};

/**
 * The material-parse options implied by a look — feed these into the batch parser's `material` option
 * so meshes are built to match it (backface culling, IBL strength). Kept out of the viewer's runtime
 * dials because they're baked at parse time, not toggleable in place.
 */
export function materialAppearanceForLook(look: Look): MaterialAppearanceOptions {
	const preset = LOOK_PRESETS[look];
	return {
		envMapIntensity: preset.envMapIntensity,
		cullBackfaces: preset.cullBackfaces
	};
}

/**
 * Initializes a Three.js environment with scene, camera, renderer, and event handling.
 */
export const initThree = function (
	canvas: HTMLCanvasElement,
	options?: ThreeInitializerOptions
): {
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
	 * Apply a coherent look to the already-loaded scene: 'technical' (matte/CAD — edges, grid, low
	 * IBL, neutral tone mapping) or 'rendered' (presentation — stronger IBL, ACES tone mapping, no
	 * edges). Retunes viewer-owned dials only; per-material parse choices are set via the batch
	 * parser's `material` option. Handy for comparing the two looks in a live viewer.
	 */
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
} {
	const config = applyDefaults(options || {});

	const sceneUp = config.environment?.sceneUp || defaultUp;

	// The configured pixel ratio is the single source of truth for every DPR consumer — renderer
	// setup, the per-frame resize check, and the AO pipeline. Resolving it once here means a
	// host-configured value (e.g. `pixelRatio: 1` for performance) is never silently overridden
	// after the first resize check. (applyDefaults always sets it; the fallback is type narrowing.)
	const pixelRatio = config.render.pixelRatio ?? Math.min(window.devicePixelRatio, 2);

	const scene = createScene(config);
	const camera = createCamera(config, canvas);
	// Set the camera's up to the scene up BEFORE OrbitControls/the controller read it — OrbitControls
	// captures the orbit basis from camera.up at construction, and the controller derives its presets
	// and ortho camera from it. Without this, a Z-up scene would orbit and frame as if Y-up.
	camera.up.copy(sceneUp);
	const renderer = setupRenderer(canvas, config, pixelRatio);
	// Report the GPU's max anisotropy to the texture cache so color maps stay sharp at grazing angles.
	// One-time; retroactively upgrades any texture already decoded this session.
	setTextureAnisotropy(renderer.capabilities.getMaxAnisotropy());
	const controls = setupControls(camera, canvas, config);

	// Tracks whichever camera (perspective or orthographic) is live; the controller swaps it.
	// Render loop, resize, and raycasting all read through getActiveCamera so 2D/3D stays coherent.
	const cameraController = createCameraController({
		scene,
		perspective: camera,
		controls,
		onActiveCameraChange: () => {},
		up: sceneUp
	});
	const getActiveCamera = () => cameraController.getActiveCamera();

	// The HDR environment decodes asynchronously; if the viewer is disposed before it lands, the
	// load callback must drop (and dispose) the texture instead of attaching it to a swept scene.
	let disposed = false;
	setupEnvironment(scene, renderer, config, () => disposed);
	// Scene lights. The shadow-casting sun (null when sunlight or shadows are off) has its shadow
	// frustum fitted to the scene content below and again whenever the host calls updateShadowBounds
	// after a geometry change — keeping shadow-map texels packed onto the model for crisp shadows at
	// any scale. The ambient + optional hemisphere fill are retunable at runtime via the setters below.
	const lights = setupLighting(scene, config);
	const sunlight = lights.sun;

	/**
	 * Refit the sun's shadow frustum to the current scene content. Call after loading or replacing
	 * geometry (e.g. right after `updateScene`). No-op when there is no shadow-casting sun or no
	 * content. Cheap: one bounds traversal, no per-frame cost.
	 */
	const updateShadowBounds = () => {
		if (sunlight) fitShadowToContent(sunlight, computeContentBounds(scene));
	};

	if (config.floor?.enabled) {
		addFloor(scene, config);
	}

	// Optional CAD aids: an infinite fading grid and the corner nav-cube gizmo. Both opt-in.
	const grid = config.grid.enabled
		? createGrid({
				cellSize: config.grid.cellSize,
				majorEvery: config.grid.majorEvery,
				cellColor: config.grid.cellColor,
				majorColor: config.grid.majorColor,
				fadeDistance: config.grid.fadeDistance,
				plane: config.grid.plane
			})
		: null;
	if (grid) scene.add(grid.object);

	/**
	 * Rescale the grid's cell spacing and fade radius to the current scene content, so a part that is
	 * a few units or a few thousand units wide both get sensibly-sized cells and a fade that reaches
	 * past the model. Call after loading or replacing geometry (e.g. right after `updateScene`). No-op
	 * when there's no grid or no content. Cheap: one bounds traversal, no per-frame cost.
	 */
	const updateGridScale = () => {
		if (grid) grid.fitToContent(computeContentBounds(scene));
	};

	const gizmo = config.gizmo.enabled
		? createViewGizmo({ camera, domElement: canvas, controller: cameraController })
		: null;

	// Per-frame near-plane fitting: recovers depth precision when zoomed out (see near-plane.ts).
	// Ground-plane normals cap the fit where an always-visible aid (grid under the camera, floor)
	// would otherwise be clipped at grazing views.
	const groundNormals: THREE.Vector3[] = [];
	if (grid) {
		// applyDefaults always fills `plane` (from the scene up axis); the fallback derives from the
		// same source rather than assuming 'z', so the two can't disagree in a non-Z-up scene.
		const plane = config.grid.plane ?? upToAxis(sceneUp);
		groundNormals.push(
			new THREE.Vector3(plane === 'x' ? 1 : 0, plane === 'y' ? 1 : 0, plane === 'z' ? 1 : 0)
		);
	}
	if (config.floor.enabled) groundNormals.push(sceneUp.clone().normalize());
	const nearFitter: NearPlaneFitter | null = config.camera.dynamicNear
		? createNearPlaneFitter({ camera, scene, groundNormals })
		: null;

	// HTML label overlay (CSS2D) and the measurement tool built on it. Both opt-in; the label layer
	// is only created when something needs it (currently the measure tool).
	const labelContainer = canvas.parentElement ?? canvas;
	const labelLayer: LabelLayer | null = config.measure.enabled
		? createLabelLayer(labelContainer, scene)
		: null;
	const measureTool: MeasureTool | null =
		config.measure.enabled && labelLayer
			? createMeasureTool({
					canvas,
					scene,
					getActiveCamera,
					labelLayer,
					options: {
						snapPixels: config.measure.snapPixels,
						color: config.measure.color,
						labelClassName: config.measure.labelClassName,
						displayUnit: config.measure.displayUnit,
						format: config.measure.format
					}
				})
			: null;

	const eventHandlers =
		config.events.enableEventHandlers !== false
			? setupEventHandlers(canvas, scene, cameraController, config)
			: { dispose: () => {}, fitToView: () => {}, clearSelection: () => {} };

	// A drag to orbit/pan ends with a `click` on mouseup. Without guarding, that release click would
	// be taken as a measurement point (placing a stray point or clearing a finished measurement when
	// the user only meant to rotate). Record where the press started and treat the release as a click
	// only if the pointer barely moved — a real click, not a drag.
	const DRAG_SLOP_PX = 5;
	let pressX = 0;
	let pressY = 0;
	const handlePointerDown = (event: MouseEvent) => {
		pressX = event.clientX;
		pressY = event.clientY;
	};
	const wasDrag = (event: MouseEvent) =>
		Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_SLOP_PX;

	// Capture-phase interceptors that pre-empt scene selection. Order: an active measurement claims
	// the click first, then the gizmo. stopImmediatePropagation keeps the selection handler from
	// also firing. (Both run in capture so they see the event before the bubble-phase selection.)
	const handleToolClick = (event: MouseEvent) => {
		if (wasDrag(event)) return; // an orbit/pan release, not a measurement click — leave it alone
		if (measureTool?.handleClick(event)) {
			event.stopImmediatePropagation();
			return;
		}
		if (gizmo?.handleClick(event)) {
			event.stopImmediatePropagation();
		}
	};
	if (gizmo || measureTool) {
		canvas.addEventListener('mousedown', handlePointerDown, { capture: true });
		canvas.addEventListener('click', handleToolClick, { capture: true });
	}
	// Forward movement to the measure tool so it can preview the snap point under the cursor. Passive:
	// it only reads, never consumes, so it never interferes with orbit/pan.
	const handleToolMove = (event: MouseEvent) => measureTool?.handleMove(event);
	if (measureTool) {
		canvas.addEventListener('mousemove', handleToolMove, { passive: true });
	}

	// Repaint request for the on-demand render loop (audit P4). Forward-declared so setters defined
	// before the loop exists can call it; rebound to the loop's real invalidate once it's created.
	let requestRender: () => void = () => {};

	// Edge overlays: bind the configured options into a closure the consumer calls after loading
	// meshes. Always applies when called explicitly (the `edges.enabled` flag governs whether the
	// host *intends* edges, but an explicit call should never be silently ignored).
	// Async path: extraction for large meshes runs in a worker, so a heavy solve never stalls the
	// main thread — their overlays pop in a beat later; small meshes still attach synchronously.
	// Cancellation (scene cleared by the next solve, clearEdges toggles) is handled inside.
	// Once attached, meshes skipped for exceeding the triangle cap switch the screen-space edge
	// fallback on (and a later solve without such meshes switches it back off).
	const applyEdges = (root: THREE.Object3D) => {
		void addEdgesAsync(root, {
			color: config.edges.color, // undefined → derive from each mesh's surface color
			darken: config.edges.darken,
			width: config.edges.width,
			thresholdAngle: config.edges.thresholdAngle,
			distanceFade: config.edges.distanceFade,
			maxTriangles: config.edges.maxTriangles,
			maxSegments: config.edges.maxSegments
		}).then(() => {
			updateEdgeFallback(root);
			requestRender(); // overlays may have attached after the solve's own repaint
		});
	};

	/** Turn the screen-space fallback on/off to match whether capped-out meshes are present. */
	const updateEdgeFallback = (root: THREE.Object3D) => {
		if (config.edges.screenSpaceFallback === false) return;
		let hasSkippedMeshes = false;
		root.traverse((object) => {
			if (object.userData?.edgesSkipped === EDGES_SKIPPED_TRIANGLE_CAP) hasSkippedMeshes = true;
		});
		if (hasSkippedMeshes !== edgeFallbackActive) {
			edgeFallbackActive = hasSkippedMeshes;
			syncPipeline();
		}
	};

	// The inverse of applyEdges: removes overlays (cancelling in-flight attaches) and stands down
	// the screen-space fallback. Hosts toggling edges off should call this rather than bare
	// removeEdges, or the fallback pass would keep drawing lines for capped meshes.
	const clearEdges = (root: THREE.Object3D) => {
		removeEdges(root);
		if (edgeFallbackActive) {
			edgeFallbackActive = false;
			syncPipeline();
		}
		requestRender();
	};

	const parent = canvas.parentElement;
	const getCanvasSize = () =>
		parent
			? { width: parent.clientWidth, height: parent.clientHeight }
			: { width: window.innerWidth, height: window.innerHeight };

	// Optional postprocessing pipeline (AO and/or the screen-space edge fallback). Held in a mutable
	// so it can be toggled at runtime; the loop reads it through getRenderPipeline each frame. When
	// null, the loop uses the plain renderer.render path. Retargeted to the active camera every frame.
	let renderPipeline: RenderPipeline | null = null;
	let aoEnabled = !!config.render.ambientOcclusion;
	// True while meshes over the edge triangle cap are in the scene and the config wants the
	// screen-space approximation for them (see EdgesConfig.screenSpaceFallback).
	let edgeFallbackActive = false;
	let builtWithAo = false;

	const buildPipeline = (withAo: boolean): RenderPipeline => {
		const { width, height } = getCanvasSize();
		const pipeline = createRenderPipeline(
			renderer,
			scene,
			getActiveCamera(),
			Math.max(1, width),
			Math.max(1, height),
			{
				toneMapping: config.render.toneMapping ?? THREE.NeutralToneMapping,
				toneMappingExposure: config.render.toneMappingExposure ?? 1,
				ambientOcclusion: withAo,
				aoIntensity: config.render.aoIntensity,
				aoPixelRatio: config.render.aoPixelRatio,
				// Constructed disabled (cheap until toggled); syncPipeline flips it via setEdgeDetection.
				edgeDetection: false
			}
		);
		pipeline.setSize(Math.max(1, width), Math.max(1, height), pixelRatio);
		return pipeline;
	};

	/** Reconcile the pipeline with what's wanted: AO presence is baked at construction, edges toggle live. */
	const syncPipeline = () => {
		const wantPipeline = aoEnabled || edgeFallbackActive;
		if (!wantPipeline) {
			renderPipeline?.dispose();
			renderPipeline = null;
			requestRender();
			return;
		}
		if (!renderPipeline || builtWithAo !== aoEnabled) {
			renderPipeline?.dispose();
			renderPipeline = buildPipeline(aoEnabled);
			builtWithAo = aoEnabled;
		}
		renderPipeline.setEdgeDetection(edgeFallbackActive);
		requestRender();
	};

	/** Dispose and rebuild the pipeline (if one is wanted) so construction-time options re-apply. */
	const rebuildPipeline = () => {
		renderPipeline?.dispose();
		renderPipeline = null;
		syncPipeline();
	};

	const setAmbientOcclusion = (enabled: boolean) => {
		aoEnabled = enabled;
		syncPipeline();
	};

	syncPipeline();

	/**
	 * Retune the fill lights at runtime — the direction-aware hemisphere fill and the flat ambient.
	 * Raising the hemisphere intensity is the most effective way to lift shadowed/under-facing
	 * surfaces that a dark HDR leaves black, without washing the whole scene flat the way ambient does.
	 * Pass `hemisphereIntensity: 0` to switch the fill off; a positive value creates the light lazily
	 * if the viewer was built without one.
	 */
	const setFillLights = (opts: {
		hemisphereIntensity?: number;
		hemisphereSkyColor?: THREE.Color | number;
		hemisphereGroundColor?: THREE.Color | number;
		ambientIntensity?: number;
	}) => {
		if (opts.ambientIntensity !== undefined) {
			lights.ambient.intensity = opts.ambientIntensity;
		}
		if (
			opts.hemisphereIntensity !== undefined &&
			!lights.hemisphere &&
			opts.hemisphereIntensity > 0
		) {
			// Built without a hemisphere light — create one on first positive intensity so hosts can
			// enable the fill purely at runtime.
			lights.hemisphere = new THREE.HemisphereLight(
				opts.hemisphereSkyColor ?? config.lighting.hemisphereSkyColor,
				opts.hemisphereGroundColor ?? config.lighting.hemisphereGroundColor,
				opts.hemisphereIntensity
			);
			lights.hemisphere.position.copy(config.environment.sceneUp ?? defaultUp);
			scene.add(lights.hemisphere);
		}
		if (lights.hemisphere) {
			if (opts.hemisphereIntensity !== undefined)
				lights.hemisphere.intensity = opts.hemisphereIntensity;
			if (opts.hemisphereSkyColor !== undefined)
				lights.hemisphere.color.set(opts.hemisphereSkyColor);
			if (opts.hemisphereGroundColor !== undefined)
				lights.hemisphere.groundColor.set(opts.hemisphereGroundColor);
		}
		requestRender();
	};

	/**
	 * Set the uniform multiplier on the HDR's image-based lighting (`scene.environmentIntensity`).
	 * Normalizes brightness across HDRs of differing exposure — lift a dim HDR or tame a bright one —
	 * so the scene isn't at the mercy of whichever HDR is loaded. Applies immediately, even before the
	 * HDR has finished decoding.
	 */
	const setEnvironmentIntensity = (intensity: number) => {
		config.environment.environmentIntensity = intensity;
		scene.environmentIntensity = intensity;
		requestRender();
	};

	/** Set renderer tone-mapping exposure at runtime. Higher lifts shadows and overall brightness. */
	const setToneMappingExposure = (exposure: number) => {
		config.render.toneMappingExposure = exposure;
		renderer.toneMappingExposure = exposure;
		// When the composer path is active, tone mapping is applied by its OutputPass — rebuild so it
		// adopts the new exposure.
		if (renderPipeline) rebuildPipeline();
	};

	/** Set GTAO strength at runtime (0 = off-looking, 1 = full). No-op when AO isn't active. */
	const setAoIntensity = (intensity: number) => {
		config.render.aoIntensity = intensity;
		if (renderPipeline) rebuildPipeline();
	};

	/**
	 * Apply a ready-to-go look to the *already-built* scene at runtime — a quick way to switch looks in
	 * a live viewer. It retunes only LIGHTING/MATERIAL: tone mapping/exposure, hemisphere fill +
	 * ambient, HDR environment intensity, AO on/off, and `envMapIntensity` on every compute material
	 * currently in the scene. It deliberately does NOT touch edges or grid (those are independent
	 * overlays — toggle them via `grid.setVisible()` / `applyEdges`). It does not rebuild geometry, so
	 * parse-time material choices (backface culling, vertex-color decode) are unaffected — set those via
	 * the batch parser's `material` option (see `getMaterialAppearance`).
	 *
	 * Note: this is a straight preset apply. Any dial you set earlier via a granular setter
	 * (`setToneMappingExposure`, `setFillLights`, …) is overwritten to the new look's value.
	 */
	const setLook = (look: Look) => {
		const preset = LOOK_PRESETS[look];
		activeLook = look;

		// Tone mapping lives on the renderer (plain path) and is mirrored into the composer's OutputPass
		// when AO is active. Rebuild the pipeline so the composer picks up the new tone mapping.
		renderer.toneMapping = preset.toneMapping;
		renderer.toneMappingExposure = preset.toneMappingExposure;
		config.render.toneMapping = preset.toneMapping;
		config.render.toneMappingExposure = preset.toneMappingExposure;

		// Fill lighting + HDR normalization: studio/showcase add hemisphere fill and lift the environment
		// so shadowed surfaces read well regardless of the HDR; technical zeroes the fill back to a flat
		// CAD look. Applied through the same setters a host would call.
		setFillLights({
			hemisphereIntensity: preset.hemisphereIntensity,
			ambientIntensity: preset.ambientIntensity
		});
		setEnvironmentIntensity(preset.environmentIntensity);

		// Rebuild (if a pipeline is active) so the composer's OutputPass adopts the new tone mapping,
		// honoring the look's AO choice.
		aoEnabled = preset.ambientOcclusion;
		if (renderPipeline) rebuildPipeline();
		else syncPipeline();

		// Retune IBL reflection strength on every compute mesh material in the scene.
		scene.traverse((object) => {
			if (object.userData.source !== 'compute') return;
			const mesh = object as Partial<THREE.Mesh> & THREE.Object3D;
			const materials = Array.isArray(mesh.material)
				? mesh.material
				: mesh.material
					? [mesh.material]
					: [];
			for (const material of materials) {
				if ('envMapIntensity' in material) {
					(material as THREE.MeshStandardMaterial).envMapIntensity = preset.envMapIntensity;
				}
			}
		});
		requestRender();
	};

	// The look currently applied. Always a real look (the default is 'studio'), seeded from the same
	// resolved value as the construction defaults. Drives `getMaterialAppearance()`.
	let activeLook: Look = config.look;

	/**
	 * The parse-time material options (backface culling, IBL strength) that match the active look —
	 * pass into the batch parser's `material` option so newly-loaded meshes are built to match it.
	 */
	const getMaterialAppearance = (): MaterialAppearanceOptions =>
		materialAppearanceForLook(activeLook);

	// Resize checked every frame so buffer resize and render happen in the same frame,
	// preventing visible blank frames on resize
	const {
		animate,
		dispose: disposeAnimation,
		invalidate
	} = createAnimationLoop(
		renderer,
		scene,
		camera,
		getActiveCamera,
		cameraController,
		controls,
		getCanvasSize,
		pixelRatio,
		config.events.onFrame,
		grid,
		gizmo,
		() => renderPipeline,
		labelLayer,
		nearFitter,
		config.render.onDemand ?? true
	);
	requestRender = invalidate;
	animate();

	scene.up.set(sceneUp.x, sceneUp.y, sceneUp.z);

	// Initial fit so any geometry already present at construction casts crisp shadows and the grid is
	// scaled to it. Hosts that add geometry later (via updateScene) should call updateShadowBounds and
	// updateGridScale again afterwards.
	updateShadowBounds();
	updateGridScale();

	// Dispose one object's renderable resources (geometry + materials + their textures), recursing
	// into children so Groups of lines/points clean up fully.
	const disposeObjectTree = (root: THREE.Object3D) => {
		root.traverse((object) => {
			const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
			if (!renderable.geometry && !renderable.material) return;
			renderable.geometry?.dispose();
			if (Array.isArray(renderable.material)) {
				renderable.material.forEach(disposeMaterialWithTextures);
			} else if (renderable.material) {
				disposeMaterialWithTextures(renderable.material);
			}
		});
	};

	const addUserGeometry = (object: THREE.Object3D) => {
		object.userData.source = 'user';
		scene.add(object);
	};

	const removeUserGeometry = (object: THREE.Object3D) => {
		object.removeFromParent();
		disposeObjectTree(object);
	};

	const clearUserGeometry = () => {
		// Snapshot first — removeFromParent mutates scene.children during iteration.
		const userObjects = scene.children.filter((child) => child.userData.source === 'user');
		userObjects.forEach((object) => {
			object.removeFromParent();
			disposeObjectTree(object);
		});
	};

	const dispose = () => {
		// Idempotent: a second call would re-run forceContextLoss() on an already-lost
		// context, throwing "INVALID_OPERATION: loseContext: context already lost".
		// Double-dispose happens naturally (React StrictMode effect double-invoke, hosts
		// that unmount twice), so guard on the flag we already track.
		if (disposed) return;
		disposed = true;
		disposeAnimation();
		eventHandlers.dispose();
		if (gizmo || measureTool) {
			canvas.removeEventListener('mousedown', handlePointerDown, { capture: true });
			canvas.removeEventListener('click', handleToolClick, { capture: true });
		}
		if (measureTool) {
			canvas.removeEventListener('mousemove', handleToolMove);
		}
		measureTool?.dispose();
		labelLayer?.dispose();
		gizmo?.dispose();
		grid?.dispose();
		renderPipeline?.dispose();
		// Stop any in-flight camera tween — its rAF ticks would otherwise keep touching the disposed
		// controls for up to the tween duration after teardown.
		cameraController.dispose();
		controls.dispose();
		renderer.dispose();
		// Free the GL context itself, not just its objects — browsers cap live WebGL contexts
		// (~16) and won't otherwise reclaim this one until GC, which can lag across rapid
		// mount/unmount cycles (e.g. navigating between definitions) and hit that cap.
		renderer.forceContextLoss();

		scene.traverse((object) => {
			// Dispose any renderable (mesh, line, points), not just meshes.
			const renderable = object as Partial<THREE.Mesh> & THREE.Object3D;
			if (!renderable.geometry && !renderable.material) return;

			renderable.geometry?.dispose();
			if (Array.isArray(renderable.material)) {
				renderable.material.forEach(disposeMaterialWithTextures);
			} else if (renderable.material) {
				disposeMaterialWithTextures(renderable.material);
			}
		});

		// Scene-level textures the traversal above can't reach.
		scene.environment?.dispose();
		if (scene.background instanceof THREE.Texture) {
			scene.background.dispose();
		}
	};

	return {
		scene,
		camera,
		controls,
		renderer,
		cameraController,
		grid,
		gizmo,
		measureTool,
		applyEdges,
		clearEdges,
		invalidate,
		setAmbientOcclusion,
		setLook,
		setFillLights,
		setEnvironmentIntensity,
		setToneMappingExposure,
		setAoIntensity,
		getMaterialAppearance,
		updateShadowBounds,
		updateGridScale,
		dispose,
		fitToView: eventHandlers.fitToView,
		clearSelection: eventHandlers.clearSelection,
		addUserGeometry,
		removeUserGeometry,
		clearUserGeometry
	};
};

// Exported for unit testing the option-precedence logic (initThree itself needs a real WebGL canvas).
export function applyDefaults(options: ThreeInitializerOptions): Required<ThreeInitializerOptions> {
	const scale = options.sceneScale || 'm';

	// All Rhino geometry is normalized to METERS (1 unit = 1 meter), sceneScale just changes the viewing perspective
	const scaleDefaults = {
		mm: {
			cameraDistance: 20,
			near: 0.1,
			far: 2000,
			floorSize: 100,
			lightDistance: 10,
			lightHeight: 20,
			minDistance: 0.1,
			shadowSize: 100,
			scaleFactor: 1000
		},
		cm: {
			cameraDistance: 20,
			near: 0.1,
			far: 2000,
			floorSize: 100,
			lightDistance: 25,
			lightHeight: 50,
			minDistance: 0.1,
			shadowSize: 100,
			scaleFactor: 100
		},
		m: {
			cameraDistance: 10,
			near: 0.01,
			far: 2000,
			floorSize: 50,
			lightDistance: 25,
			lightHeight: 50,
			minDistance: 0.001,
			shadowSize: 100,
			scaleFactor: 1
		},
		inches: {
			cameraDistance: 15,
			near: 0.1,
			far: 2000,
			floorSize: 80,
			lightDistance: 20,
			lightHeight: 40,
			minDistance: 0.1,
			shadowSize: 80,
			scaleFactor: 39.37
		},
		feet: {
			cameraDistance: 8,
			near: 0.1,
			far: 2000,
			floorSize: 40,
			lightDistance: 15,
			lightHeight: 30,
			minDistance: 0.1,
			shadowSize: 60,
			scaleFactor: 3.28084
		}
	};

	const defaults = scaleDefaults[scale];

	// The chosen look seeds the lighting/material defaults (tone mapping, AO, IBL, fill). It sits BELOW
	// explicit per-field options (those still win) and ABOVE the plain per-field defaults — so it only
	// fills what the caller left unspecified. Always a real preset: the default IS a look ('studio'),
	// so there's no "no look" state to represent. A look never touches edges/grid — those resolve from
	// their own configs below.
	const look = options.look ?? DEFAULT_LOOK;
	const preset = LOOK_PRESETS[look];

	return {
		sceneScale: scale,
		look,
		camera: {
			// Default 3/4 iso: behind-left and ABOVE the model. Derived from the scene up axis rather
			// than a literal Z-up vector, so a Y-up scene gets an overhead iso instead of a
			// below-horizon view.
			// `cameraDistance` was historically a PER-COMPONENT magnitude on a (-d, -d, d) vector, so the
			// effective orbit radius is d*sqrt(3). Preserved exactly so this change reorients the default
			// view without also changing how zoomed-in every scene starts.
			position:
				options.camera?.position ||
				isoOffset(
					options.environment?.sceneUp ?? defaultUp,
					defaults.cameraDistance * Math.sqrt(3)
				),
			fov: options.camera?.fov || 20,
			near: options.camera?.near || defaults.near,
			far: options.camera?.far || defaults.far,
			target: options.camera?.target || new THREE.Vector3(0, 0, 0),
			dynamicNear: options.camera?.dynamicNear ?? true
		},
		lighting: {
			enableSunlight: options.lighting?.enableSunlight ?? true,
			sunlightIntensity: options.lighting?.sunlightIntensity ?? 1,
			// Sun overhead and offset to one side, expressed in the scene basis so it stays overhead in
			// any up convention (a hardcoded +Z height made the sun near-horizontal in a Y-up scene).
			sunlightPosition:
				options.lighting?.sunlightPosition ||
				sunOffset(
					options.environment?.sceneUp ?? defaultUp,
					defaults.lightDistance,
					defaults.lightHeight
				),
			ambientLightColor: options.lighting?.ambientLightColor || new THREE.Color(0x404040),
			// The look sets ambient low across the board — the hemisphere fill + env carry the lift, so
			// flat ambient is only a thin floor keeping shadows off pure black. Explicit option still wins.
			ambientLightIntensity: options.lighting?.ambientLightIntensity ?? preset.ambientIntensity,
			sunlightColor: options.lighting?.sunlightColor || 0xffffff, // Default to white sunlight
			// Direction-aware fill. The look decides whether it's on (a positive hemisphereIntensity is
			// what actually creates the light in setupLighting); an explicit option overrides.
			enableHemisphereLight:
				options.lighting?.enableHemisphereLight ?? preset.hemisphereIntensity > 0,
			hemisphereSkyColor: options.lighting?.hemisphereSkyColor ?? 0xdfe6ff,
			// A slightly warm ground tint reads as bounced light and keeps fill from desaturating colour.
			hemisphereGroundColor: options.lighting?.hemisphereGroundColor ?? 0x6b5f52,
			hemisphereIntensity: options.lighting?.hemisphereIntensity ?? preset.hemisphereIntensity
		},
		environment: {
			hdrPath: options.environment?.hdrPath || '/baseHDR.hdr',
			backgroundColor: options.environment?.backgroundColor || new THREE.Color(0xf0f0f0),
			enableEnvironmentLighting: options.environment?.enableEnvironmentLighting ?? true,
			sceneUp: options.environment?.sceneUp || defaultUp,
			showEnvironment: options.environment?.showEnvironment ?? false,
			environmentIntensity: options.environment?.environmentIntensity ?? preset.environmentIntensity
		},
		floor: {
			enabled: options.floor?.enabled ?? false,
			size: options.floor?.size || defaults.floorSize,
			color: options.floor?.color || new THREE.Color(0x808080),
			roughness: options.floor?.roughness ?? 0.7,
			metalness: options.floor?.metalness ?? 0.0,
			receiveShadow: options.floor?.receiveShadow ?? true
		},
		render: {
			enableShadows: options.render?.enableShadows ?? true,
			shadowMapSize: options.render?.shadowMapSize || 2048,
			antialias: options.render?.antialias ?? true,
			pixelRatio: options.render?.pixelRatio || Math.min(window.devicePixelRatio, 2),
			// ?? not || so an explicit NoToneMapping (=== 0) is honoured rather than falling through.
			toneMapping: options.render?.toneMapping ?? preset.toneMapping,
			toneMappingExposure: options.render?.toneMappingExposure ?? preset.toneMappingExposure,
			preserveDrawingBuffer: options.render?.preserveDrawingBuffer ?? false,
			ambientOcclusion: options.render?.ambientOcclusion ?? preset.ambientOcclusion,
			aoIntensity: options.render?.aoIntensity ?? 1,
			// Cap AO buffers at 1× by default — the biggest lever on GTAO cost on high-DPI displays.
			aoPixelRatio: options.render?.aoPixelRatio ?? 1,
			// On-demand rendering (audit P4): draw only when something changed. Opt-out flag.
			onDemand: options.render?.onDemand ?? true
		},
		controls: {
			enableDamping: options.controls?.enableDamping ?? false,
			dampingFactor: options.controls?.dampingFactor || 0.05,
			autoRotate: options.controls?.autoRotate ?? false,
			autoRotateSpeed: options.controls?.autoRotateSpeed || 0.5,
			enableZoom: options.controls?.enableZoom ?? true,
			enablePan: options.controls?.enablePan ?? true,
			minDistance: options.controls?.minDistance || defaults.minDistance,
			maxDistance: options.controls?.maxDistance || Infinity
		},
		grid: {
			// Defaults mirror createGrid's so the two never drift. Grid is an independent overlay — a
			// look never toggles it.
			enabled: options.grid?.enabled ?? false,
			cellSize: options.grid?.cellSize ?? 1,
			majorEvery: options.grid?.majorEvery ?? 10,
			cellColor: options.grid?.cellColor ?? 0x888888,
			majorColor: options.grid?.majorColor ?? 0x444444,
			fadeDistance: options.grid?.fadeDistance ?? 100,
			// The "ground" plane is the one orthogonal to the scene up axis, so the grid lies under the
			// model regardless of up convention (Z-up Rhino → 'z'; Y-up → 'y'). Explicit `plane` wins.
			plane: options.grid?.plane ?? upToAxis(options.environment?.sceneUp ?? defaultUp)
		},
		gizmo: {
			enabled: options.gizmo?.enabled ?? false
		},
		edges: {
			// Defaults mirror addEdges' so the two never drift. Edges are an independent overlay — a
			// look never toggles them.
			enabled: options.edges?.enabled ?? false,
			// No color default: leaving it undefined lets addEdges derive each mesh's edge color from
			// its own surface material (darkened). Set a color explicitly to force one uniform tint.
			color: options.edges?.color,
			darken: options.edges?.darken,
			width: options.edges?.width ?? 1.5,
			thresholdAngle: options.edges?.thresholdAngle ?? 44,
			distanceFade: options.edges?.distanceFade ?? true
		},
		measure: {
			// Visual defaults live in createMeasureTool; only `enabled` needs a value here, the rest
			// pass through (undefined → the tool's own default).
			enabled: options.measure?.enabled ?? false,
			snapPixels: options.measure?.snapPixels,
			color: options.measure?.color,
			labelClassName: options.measure?.labelClassName,
			displayUnit: options.measure?.displayUnit,
			format: options.measure?.format
		},
		events: {
			onBackgroundClicked: options.events?.onBackgroundClicked,
			onObjectSelected: options.events?.onObjectSelected,
			onMeshMetadataClicked: options.events?.onMeshMetadataClicked,
			onMeshDoubleClicked: options.events?.onMeshDoubleClicked,
			selectionColor: options.events?.selectionColor || '#ff0000', // Default to red
			enableEventHandlers: options.events?.enableEventHandlers ?? true,
			enableKeyboardControls: options.events?.enableKeyboardControls ?? true,
			enableClickToFocus: options.events?.enableClickToFocus ?? true,
			enableDoubleClickZoom: options.events?.enableDoubleClickZoom ?? true,
			onReady: options.events?.onReady,
			onFrame: options.events?.onFrame
		}
	};
}

/**
 * Dispose a material together with any textures it references (`map`, `roughnessMap`, …), matching
 * `clearScene`'s texture sweep (three-helpers) so no teardown path leaks GPU textures across viewer
 * mount/unmount cycles. Walks own enumerable properties only — `for...in` would needlessly iterate
 * the prototype chain.
 */
export function disposeMaterialWithTextures(material: THREE.Material): void {
	for (const value of Object.values(material)) {
		if (value instanceof THREE.Texture) {
			value.dispose();
		}
	}
	material.dispose();
}

/**
 * Fit a directional light's shadow camera to the scene content. The orthographic shadow frustum is
 * sized to the content's bounding sphere (padded), so the fixed shadow-map texels cover only the
 * model rather than a generous constant area — the dominant lever on shadow crispness. Near/far are
 * derived from how far the light sits from the content centre, keeping depth precision tight.
 *
 * No-op when there is no content (an empty box would collapse the frustum to a point).
 */
function fitShadowToContent(light: THREE.DirectionalLight, bounds: THREE.Box3): void {
	if (bounds.isEmpty()) return;

	const center = bounds.getCenter(new THREE.Vector3());
	// Bounding-sphere radius makes the frustum rotation-invariant: the light can shine from any
	// angle and the model still fits, with no per-angle recompute. Pad so grazing-angle casters and
	// soft-shadow (VSM) blur near the edges don't clip.
	const radius = bounds.getSize(new THREE.Vector3()).length() * 0.5 * 1.2;

	const cam = light.shadow.camera;
	cam.left = -radius;
	cam.right = radius;
	cam.top = radius;
	cam.bottom = -radius;

	// Aim the shadow camera at the content centre. The light keeps its configured *position*; only
	// its target moves, so the lighting direction is preserved while the shadow frustum recentres.
	light.target.position.copy(center);
	light.target.updateMatrixWorld();

	// Near/far bracket the content along the light→centre axis. Clamp near to a small positive value
	// so a light sitting inside the bounds can't push near ≤ 0.
	const lightDistance = light.position.distanceTo(center);
	cam.near = Math.max(radius * 0.01, lightDistance - radius);
	cam.far = lightDistance + radius;
	cam.updateProjectionMatrix();
}

function createScene(config: Required<ThreeInitializerOptions>): THREE.Scene {
	const scene = new THREE.Scene();

	const bgColor =
		typeof config.environment.backgroundColor === 'string'
			? new THREE.Color(config.environment.backgroundColor)
			: config.environment.backgroundColor;
	scene.background = bgColor || null;

	return scene;
}

// Resize applied before render so buffer clear and draw happen in the same frame,
// preventing visible blank frames when the canvas is resized
function createAnimationLoop(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.PerspectiveCamera,
	getActiveCamera: () => THREE.Camera,
	cameraController: CameraController,
	controls: OrbitControls,
	getCanvasSize: () => { width: number; height: number },
	// The resolved config.render.pixelRatio — the single source of truth for DPR (see initThree).
	pixelRatio: number,
	onFrame?: (delta: number) => void,
	grid?: Grid | null,
	gizmo?: ViewGizmo | null,
	getRenderPipeline?: () => RenderPipeline | null,
	labelLayer?: LabelLayer | null,
	nearFitter?: NearPlaneFitter | null,
	// On-demand rendering (audit P4): render only when something changed. False = legacy every-frame.
	onDemand: boolean = true
): { animate: () => void; dispose: () => void; invalidate: () => void } {
	let animationId: number | null = null;
	let lastTime = performance.now();

	// The loop always *ticks* (updates are cheap); it only *renders* when: invalidate() was called
	// (scene content, style toggles, async edge attach), the active camera moved — a matrix compare
	// catches every driver: damping, presets, gizmo snaps, near-plane refits — or the safety repaint
	// interval elapsed, which bounds the staleness of any mutation that forgot to invalidate.
	let renderRequested = true; // first frame always renders
	let lastRenderTime = 0;
	const IDLE_REPAINT_INTERVAL_MS = 500;
	const lastWorldMatrix = new THREE.Matrix4();
	const lastProjectionMatrix = new THREE.Matrix4();
	let lastCamera: THREE.Camera | null = null;
	const invalidate = () => {
		renderRequested = true;
	};

	const cameraMoved = (activeCamera: THREE.Camera): boolean => {
		// matrixWorld is normally refreshed by renderer.render — which we're deciding whether to
		// call — so refresh it here first (cheap: a camera has no deep subtree).
		activeCamera.updateMatrixWorld();
		const moved =
			lastCamera !== activeCamera ||
			!lastWorldMatrix.equals(activeCamera.matrixWorld) ||
			!lastProjectionMatrix.equals(activeCamera.projectionMatrix);
		if (moved) {
			lastCamera = activeCamera;
			lastWorldMatrix.copy(activeCamera.matrixWorld);
			lastProjectionMatrix.copy(activeCamera.projectionMatrix);
		}
		return moved;
	};

	// Pointer/wheel activity is a catch-all for click-driven scene mutations (measure points,
	// selection highlights) whose code paths predate on-demand rendering.
	const canvas = renderer.domElement;
	const pointerEvents = ['pointerdown', 'pointerup', 'wheel'] as const;
	if (onDemand) {
		for (const type of pointerEvents) {
			canvas.addEventListener(type, invalidate, { passive: true });
		}
	}

	const checkResize = () => {
		const { width, height } = getCanvasSize();
		if (width === 0 || height === 0) return;

		// Must floor, not round: renderer.setSize floors the buffer size, and a mismatched rounding
		// here makes the comparison never settle — the resize branch would then run every frame.
		const newW = Math.floor(width * pixelRatio);
		const newH = Math.floor(height * pixelRatio);

		if (renderer.domElement.width !== newW || renderer.domElement.height !== newH) {
			renderer.setPixelRatio(pixelRatio);
			renderer.setSize(width, height, false);
			camera.aspect = width / height;
			camera.updateProjectionMatrix();
			// Reshape the orthographic frustum too, if it's the active projection.
			cameraController.updateAspect(width, height);
			// Keep the AO composer's render targets in step with the canvas.
			getRenderPipeline?.()?.setSize(width, height, pixelRatio);
			// CSS2D overlay matches the canvas's CSS size (not the pixel-ratio buffer size).
			labelLayer?.setSize(width, height);
			invalidate();
		}
	};

	const animate = function () {
		animationId = requestAnimationFrame(animate);

		const now = performance.now();
		const delta = (now - lastTime) / 1000;
		lastTime = now;

		checkResize();

		if (controls.enableDamping || controls.autoRotate) {
			controls.update();
		}

		// Keep the grid centered on the camera so it reads as infinite.
		if (grid) grid.update(getActiveCamera().position);

		// Advance the gizmo's fade/spin animation (no-op when idle).
		if (gizmo) gizmo.update(delta);

		// Refit the perspective near plane to the camera↔content gap (after controls moved the
		// camera, before anything renders) so depth precision tracks the viewing distance.
		if (nearFitter) nearFitter.update();

		onFrame?.(delta);

		const activeCamera = getActiveCamera();

		// On-demand gate: skip the draw (the expensive part, especially with the AO composer) when
		// nothing changed. Ticking continues regardless, so damping/tweens re-trigger via the camera
		// compare on their next movement.
		if (onDemand) {
			const shouldRender =
				renderRequested ||
				cameraMoved(activeCamera) ||
				now - lastRenderTime >= IDLE_REPAINT_INTERVAL_MS;
			if (!shouldRender) return;
			renderRequested = false;
			lastRenderTime = now;
		}

		const renderPipeline = getRenderPipeline?.();
		if (renderPipeline) {
			// AO path: composer owns the render. Retarget to the active camera in case 2D/3D swapped.
			renderPipeline.setCamera(activeCamera);
			renderPipeline.render(delta);
		} else {
			renderer.render(scene, activeCamera);
		}

		// HTML labels follow their 3D anchors — render the DOM overlay against the active camera.
		if (labelLayer) labelLayer.render(scene, activeCamera);

		// The gizmo draws as an overlay in a corner viewport with its own clear; render it last so it
		// sits on top of the scene.
		if (gizmo) gizmo.render(renderer);
	};

	const dispose = () => {
		if (animationId !== null) {
			cancelAnimationFrame(animationId);
			animationId = null;
		}
		if (onDemand) {
			for (const type of pointerEvents) {
				canvas.removeEventListener(type, invalidate);
			}
		}
	};

	return { animate, dispose, invalidate };
}

function setupEnvironment(
	scene: THREE.Scene,
	renderer: THREE.WebGLRenderer,
	config: Required<ThreeInitializerOptions>,
	isDisposed: () => boolean
) {
	if (config.environment.enableEnvironmentLighting) {
		new HDRLoader().load(
			config.environment.hdrPath || '/baseHDR.hdr',
			function (envMap) {
				// The viewer can be torn down while the HDR is still fetching/decoding (fast
				// mount/unmount). dispose() has already swept the scene, so adopting the texture now
				// would leak it — and onReady must not fire on a dead viewer.
				if (isDisposed()) {
					envMap.dispose();
					return;
				}
				if (!envMap?.image) {
					getLogger().warn('HDR loaded without image data; skipping environment map.');
					// The texture object still holds GPU/CPU resources even without usable image data —
					// dispose it, since it will never be attached to the scene.
					envMap?.dispose();
					config.events.onReady?.();
					return;
				}
				envMap.mapping = THREE.EquirectangularReflectionMapping;

				// Prefilter the raw equirect HDR through PMREM: this builds the roughness-aware mip
				// chain a MeshStandardMaterial samples for image-based lighting. Without it, three
				// falls back to sampling the equirect map directly and a rough surface reads a near-
				// mirror level — reflections stay unnaturally sharp/busy and specular highlights
				// sparkle, which is a big part of the "not quite right" look. The prefiltered cube is
				// what drives IBL; the raw equirect is kept only if it's also shown as the background.
				const pmrem = new THREE.PMREMGenerator(renderer);
				pmrem.compileEquirectangularShader();
				const prefiltered = pmrem.fromEquirectangular(envMap).texture;
				pmrem.dispose();

				scene.environment = prefiltered;
				// Normalize the HDR's IBL contribution so brightness is consistent across HDRs of
				// differing exposure, instead of dim-HDR-looks-dim / bright-HDR-blows-out.
				scene.environmentIntensity = config.environment.environmentIntensity ?? 1;
				// Equirectangular mapping assumes the HDR's horizon lies in the XZ plane — i.e. Y-up.
				// This scene is Z-up, so without a rotation the environment sits on its side: the
				// horizon runs vertically and the sky lights the model from +Y instead of from above.
				// Invisible on a neutral studio HDR, obvious on any HDR with a sky/ground split.
				const envRotation = environmentRotationFor(config.environment.sceneUp ?? defaultUp);
				scene.environmentRotation.copy(envRotation);
				if (config.environment.showEnvironment) {
					// Background wants the full-resolution equirect, not the low-res prefiltered probe —
					// so keep the raw map for that and let it dispose with the scene background sweep.
					scene.background = envMap;
					// Keep the visible background locked to the same orientation as the IBL probe;
					// they are separate properties and drift apart if only one is set.
					scene.backgroundRotation.copy(envRotation);
				} else {
					// The raw equirect was only an input to PMREM; the prefiltered probe has superseded
					// it for IBL and nothing else references it, so release it now.
					envMap.dispose();
				}
				config.events.onReady?.();
			},
			undefined,
			function (error) {
				if (isDisposed()) return;
				getLogger().warn('HDR texture could not be loaded, falling back to basic lighting:', error);
				config.events.onReady?.();
			}
		);
	} else {
		config.events.onReady?.();
	}
}

/** The lights created by {@link setupLighting}, handed back so runtime setters can retune them. */
type SceneLights = {
	ambient: THREE.AmbientLight;
	/** Hemisphere fill light — null unless `lighting.enableHemisphereLight`. */
	hemisphere: THREE.HemisphereLight | null;
	/**
	 * Shadow-casting sun. Null when sunlight is disabled or shadows are off — the caller uses it only
	 * to refit the shadow frustum on geometry change (see `fitShadowToContent`), so null means nothing
	 * to refit.
	 */
	sun: THREE.DirectionalLight | null;
};

/**
 * Set up scene lighting. Returns handles to the created lights so the caller can refit the sun's
 * shadow frustum on geometry change and retune fill lights at runtime.
 */
function setupLighting(scene: THREE.Scene, config: Required<ThreeInitializerOptions>): SceneLights {
	const ambient = new THREE.AmbientLight(
		config.lighting.ambientLightColor,
		config.lighting.ambientLightIntensity
	);
	scene.add(ambient);

	// Hemisphere fill: soft sky-from-above / ground-from-below light that lifts occluded and
	// downward-facing surfaces the HDR may leave dark. Aligned to the scene up so "sky" is genuinely
	// up in a Z-up scene (a HemisphereLight defaults to +Y up).
	let hemisphere: THREE.HemisphereLight | null = null;
	if (config.lighting.enableHemisphereLight) {
		hemisphere = new THREE.HemisphereLight(
			config.lighting.hemisphereSkyColor,
			config.lighting.hemisphereGroundColor,
			config.lighting.hemisphereIntensity
		);
		const up = config.environment.sceneUp ?? defaultUp;
		hemisphere.position.copy(up);
		scene.add(hemisphere);
	}

	if (!config.lighting.enableSunlight) return { ambient, hemisphere, sun: null };

	const sunlight = new THREE.DirectionalLight(
		config.lighting.sunlightColor ?? 0xffffff,
		config.lighting.sunlightIntensity
	);
	const pos = config.lighting.sunlightPosition;
	if (pos) {
		sunlight.position.set(pos.x, pos.y, pos.z);
	}

	if (!config.render.enableShadows) {
		scene.add(sunlight);
		return { ambient, hemisphere, sun: null };
	}

	sunlight.castShadow = true;

	// The frustum bounds (left/right/top/bottom/near/far) are not set here — they are fitted to the
	// scene content by fitShadowToContent, called at init and on every geometry change. Sizing them
	// to the model instead of a fixed constant is the dominant lever on shadow crispness.
	sunlight.shadow.mapSize.width = config.render.shadowMapSize || 2048;
	sunlight.shadow.mapSize.height = config.render.shadowMapSize || 2048;

	sunlight.shadow.bias = -0.0001;
	sunlight.shadow.normalBias = 0.02;
	// Soften VSM edges; cheap and only meaningful once the frustum is tight (see fitShadowToContent).
	sunlight.shadow.radius = 4;

	scene.add(sunlight);
	// A DirectionalLight aims at its target's world position; the target must be in the scene graph
	// for its matrix to update. fitShadowToContent moves this target to the content centre.
	scene.add(sunlight.target);
	return { ambient, hemisphere, sun: sunlight };
}

function addFloor(scene: THREE.Scene, config: Required<ThreeInitializerOptions>) {
	const floorSize = config.floor.size;
	const floorGeometry = new THREE.PlaneGeometry(floorSize, floorSize);

	const floorColor =
		typeof config.floor.color === 'string'
			? new THREE.Color(config.floor.color)
			: config.floor.color;

	const floorMaterial = new THREE.MeshStandardMaterial({
		color: floorColor,
		roughness: config.floor.roughness,
		metalness: config.floor.metalness,
		side: THREE.DoubleSide
	});

	const floor = new THREE.Mesh(floorGeometry, floorMaterial);
	floor.userData.id = 'floor';
	floor.name = 'floor';
	// PlaneGeometry lies in XY with a +Z normal — already the ground for a Z-up scene. Orient its
	// normal to the scene up axis so the floor is the ground plane in any up convention.
	const up = (config.environment?.sceneUp || defaultUp).clone().normalize();
	floor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
	floor.position.set(0, 0, 0);

	if (config.floor.receiveShadow && config.render.enableShadows) {
		floor.receiveShadow = true;
	}

	scene.add(floor);
}

function createCamera(
	config: Required<ThreeInitializerOptions>,
	canvas: HTMLCanvasElement
): THREE.PerspectiveCamera {
	const parent = canvas.parentElement;
	const width = parent ? parent.clientWidth : window.innerWidth;
	const height = parent ? parent.clientHeight : window.innerHeight;

	const camera = new THREE.PerspectiveCamera(
		config.camera.fov,
		width / height,
		config.camera.near,
		config.camera.far
	);

	const pos = config.camera.position;
	if (pos) {
		camera.position.set(pos.x, pos.y, pos.z);
	}

	return camera;
}

function setupRenderer(
	canvas: HTMLCanvasElement,
	config: Required<ThreeInitializerOptions>,
	pixelRatio: number
): THREE.WebGLRenderer {
	const renderer = new THREE.WebGLRenderer({
		antialias: config.render.antialias,
		canvas,
		alpha: true,
		powerPreference: 'high-performance',
		preserveDrawingBuffer: config.render.preserveDrawingBuffer,
		// Deliberately NOT logarithmic: three's depth-based post passes (our GTAO pipeline) reconstruct
		// view-space positions assuming standard perspective depth and do not support log-encoded
		// depth — with it on, AO is computed from wrong depths (haloing, wrong-scale occlusion). The
		// per-scale near/far defaults (see applyDefaults) keep standard depth precision adequate for
		// the viewer's scene scales. If log depth is ever needed, AO must be disabled with it.
		logarithmicDepthBuffer: false
	});

	const parent = canvas.parentElement;
	const width = parent ? parent.clientWidth : window.innerWidth;
	const height = parent ? parent.clientHeight : window.innerHeight;

	if (parent) {
		canvas.style.width = '100%';
		canvas.style.height = '100%';
		canvas.style.display = 'block';
	}

	renderer.setSize(width, height, false);
	renderer.setPixelRatio(pixelRatio);

	if (config.render.enableShadows) {
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.VSMShadowMap;
	}

	renderer.toneMapping = config.render.toneMapping!;
	renderer.toneMappingExposure = config.render.toneMappingExposure ?? 1.0;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	renderer.sortObjects = true;

	return renderer;
}

function setupEventHandlers(
	canvas: HTMLCanvasElement,
	scene: THREE.Scene,
	cameraController: CameraController,
	config: Required<ThreeInitializerOptions>
): {
	dispose: () => void;
	fitToView: () => void;
	clearSelection: () => void;
} {
	const selectedObjects = new Set<THREE.Object3D>();
	const originalMaterials = new Map<THREE.Object3D, THREE.Material | THREE.Material[]>();
	const raycaster = new THREE.Raycaster();
	const mouse = new THREE.Vector2();
	const mouseDownPosition = new THREE.Vector2();
	const getActiveCamera = () => cameraController.getActiveCamera();

	// An object is hittable only if every ancestor is also visible. Three.js's
	// recursive intersect doesn't enforce that — it can hit a visible Mesh inside
	// a hidden Group.
	const isFullyVisible = (object: THREE.Object3D): boolean => {
		let current: THREE.Object3D | null = object;
		while (current) {
			if (!current.visible) return false;
			current = current.parent;
		}
		return true;
	};

	const fitToView = () => {
		// Frame the scene's renderable content; viewer aids (grid/floor/labels/measure) are excluded so
		// the camera-tracking grid plane can't dominate the bounds and blow up the fit distance.
		const box = computeContentBounds(scene);

		if (box.isEmpty()) {
			getLogger().warn('No objects to fit to view');
			return;
		}

		// Delegate the move to the camera controller: it frames from the current view direction and
		// repositions whichever camera is LIVE, re-deriving the ortho frustum in 2D mode — whereas
		// moving the perspective camera directly would change nothing visible in 2D (and silently
		// drag the invisible perspective camera out of sync).
		cameraController.frameBounds(box, false);
	};

	const selectionColorObj =
		typeof config.events.selectionColor === 'string'
			? new THREE.Color(config.events.selectionColor)
			: config.events.selectionColor instanceof THREE.Color
				? config.events.selectionColor
				: new THREE.Color('#ff0000');

	const clearSelection = () => {
		selectedObjects.forEach((obj) => {
			const restorable = obj as THREE.Object3D & {
				material?: THREE.Material | THREE.Material[];
			};
			if (originalMaterials.has(obj)) {
				const original = originalMaterials.get(obj)!;
				// Dispose the clone we swapped in before restoring the original.
				const clone = restorable.material;
				if (clone instanceof THREE.Material) clone.dispose();
				else if (Array.isArray(clone)) clone.forEach((m) => m.dispose());
				restorable.material = original;
				originalMaterials.delete(obj);

				// If the object left the scene while selected (a solve's clearScene only saw — and
				// disposed — the highlight clone), no later scene traversal can reach the original we
				// just restored, so it must be disposed here. Compute content is cleared wholesale per
				// solve, so a detached object's material has no surviving sharers.
				let root: THREE.Object3D = obj;
				while (root.parent) root = root.parent;
				if (root !== scene) {
					if (original instanceof THREE.Material) original.dispose();
					else original.forEach((m) => m.dispose());
				}
			}
		});
		selectedObjects.clear();
	};

	// Highlight a selected object by cloning its material and recoloring. Meshes get an `emissive`
	// tint (so the surface keeps its base color); lines and points have no emissive channel, so we
	// recolor `color` directly. Returns true if a highlight was applied (a material was found).
	const applyHighlight = (object: THREE.Object3D): boolean => {
		const target = object as THREE.Object3D & { material?: THREE.Material | THREE.Material[] };
		if (!(target.material instanceof THREE.Material)) return false;

		originalMaterials.set(object, target.material);
		const clone = target.material.clone();

		if (object instanceof THREE.Mesh && 'emissive' in clone) {
			(clone as THREE.MeshStandardMaterial).emissive = selectionColorObj.clone();
		} else if ('color' in clone) {
			(clone as THREE.LineBasicMaterial).color = selectionColorObj.clone();
		}

		target.material = clone;
		return true;
	};

	// Picking lines and points needs a ray-to-geometry tolerance, scaled to the scene so it holds at
	// any zoom. Plain THREE.Points use Raycaster.params.Points.threshold; fat Line2 uses its own
	// material linewidth, so only Points needs this. (THREE.Line would use params.Line.threshold, but
	// curves here are Line2.) Recomputed per pick from the current scene bounds.
	const updatePickThresholds = () => {
		const box = computeContentBounds(scene);
		const diagonal = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
		raycaster.params.Points.threshold = diagonal * 0.01;
	};

	const handleMouseDown = (event: MouseEvent) => {
		mouseDownPosition.set(event.clientX, event.clientY);
	};

	const handleCanvasClick = (event: MouseEvent) => {
		// Ignore if mouse has moved (drag)
		const currentMousePosition = new THREE.Vector2(event.clientX, event.clientY);
		if (mouseDownPosition.distanceTo(currentMousePosition) > 5) {
			return;
		}

		const rect = canvas.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		const intersects = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => isFullyVisible(i.object));

		if (intersects.length > 0) {
			const clickedObject = intersects[0].object;

			if (!selectedObjects.has(clickedObject)) {
				clearSelection();
				selectedObjects.add(clickedObject);

				// Clone material (so siblings sharing it are untouched) and recolor to highlight.
				// Handles meshes, fat lines, and points alike.
				applyHighlight(clickedObject);

				config.events?.onObjectSelected?.(clickedObject);

				if (clickedObject instanceof THREE.Mesh && Object.keys(clickedObject.userData).length > 0) {
					config.events?.onMeshMetadataClicked?.(clickedObject.userData);
				}
			}
		} else {
			clearSelection();
			config.events?.onBackgroundClicked?.({ x: mouse.x, y: mouse.y });
		}
	};

	const handleDoubleClick = (event: MouseEvent) => {
		const rect = canvas.getBoundingClientRect();
		mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		updatePickThresholds();
		raycaster.setFromCamera(mouse, getActiveCamera());
		const intersects = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => isFullyVisible(i.object));

		if (intersects.length === 0) return;

		const target = intersects[0].object;
		config.events?.onMeshDoubleClicked?.(target);

		if (!config.events?.enableDoubleClickZoom) return;

		const box = new THREE.Box3().setFromObject(target);
		if (box.isEmpty()) return;

		// Frame the clicked object via the controller so the ACTIVE camera moves (ortho included —
		// its frustum is re-derived, since translating an ortho camera alone zooms nothing). The
		// controller's tween is cancellable: a rapid second double-click replaces the first tween
		// instead of running a competing loop, and dispose() stops it outright.
		cameraController.frameBounds(box, true);
	};

	const handleKeydown = (event: KeyboardEvent) => {
		if (!config.events?.enableKeyboardControls) return;

		switch (event.key.toLowerCase()) {
			case 'f':
				event.preventDefault();
				fitToView();
				break;
			case 'escape':
				event.preventDefault();
				clearSelection();
				break;
			case ' ':
				event.preventDefault();
				fitToView();
				break;
		}
	};

	if (config.events?.enableClickToFocus) {
		canvas.addEventListener('mousedown', handleMouseDown);
		canvas.addEventListener('click', handleCanvasClick);
		canvas.addEventListener('dblclick', handleDoubleClick);
	}

	if (config.events?.enableKeyboardControls) {
		canvas.setAttribute('tabindex', '0');
		canvas.addEventListener('keydown', handleKeydown);
	}

	const dispose = () => {
		canvas.removeEventListener('mousedown', handleMouseDown);
		canvas.removeEventListener('click', handleCanvasClick);
		canvas.removeEventListener('dblclick', handleDoubleClick);
		canvas.removeEventListener('keydown', handleKeydown);
		clearSelection();
	};

	return { dispose, fitToView, clearSelection };
}

function setupControls(
	camera: THREE.PerspectiveCamera,
	canvas: HTMLCanvasElement,
	config: Required<ThreeInitializerOptions>
): OrbitControls {
	const controls = new OrbitControls(camera, canvas);

	const target = config.camera.target;
	if (target) {
		controls.target.set(target.x, target.y, target.z);
	}

	controls.enableDamping = config.controls.enableDamping || false;
	controls.dampingFactor = config.controls.dampingFactor || 0.05;

	controls.autoRotate = config.controls.autoRotate || false;
	controls.autoRotateSpeed = config.controls.autoRotateSpeed || 0.5;

	controls.enableZoom = config.controls.enableZoom ?? true;
	controls.enablePan = config.controls.enablePan ?? true;
	controls.minDistance = config.controls.minDistance || 0.001;
	controls.maxDistance = config.controls.maxDistance || Infinity;

	controls.screenSpacePanning = false;
	controls.maxPolarAngle = Math.PI;

	controls.update();
	return controls;
}
