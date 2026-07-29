import * as THREE from 'three';

import { createCameraController } from '../camera-controller.js';
import { EDGES_SKIPPED_TRIANGLE_CAP, addEdgesAsync, removeEdges } from '../edges.js';
import { createGrid } from '../grid.js';
import { createLabelLayer, type LabelLayer } from '../label-layer.js';
import { createMeasureTool, type MeasureTool } from '../measure.js';
import { createNearPlaneFitter, type NearPlaneFitter } from '../near-plane.js';
import { computeContentBounds } from '../three-helpers.js';
import type { ThreeInitializerOptions } from '../types.js';
import { upToAxis } from '../up-axis.js';
import { createViewGizmo } from '../view-gizmo.js';
import { createAnimationLoop } from './animation-loop.js';
import { createAppearanceController } from './appearance.js';
import { createCamera } from './create-camera.js';
import { createScene } from './create-scene.js';
import { applyDefaults, defaultUp } from './defaults.js';
import { disposeObjectTree, disposeSceneResources } from './dispose.js';
import { createPipelineController } from './pipeline-controller.js';
import { setupControls } from './setup-controls.js';
import { addFloor, setupEnvironment } from './setup-environment.js';
import { setupEventHandlers } from './setup-events.js';
import { fitShadowToContent, setupLighting } from './setup-lighting.js';
import { setupRenderer } from './setup-renderer.js';
import type { ThreeViewer } from './viewer.js';

/**
 * Initializes a Three.js environment with scene, camera, renderer, and event handling.
 */
export const initThree = function (
	canvas: HTMLCanvasElement,
	options?: ThreeInitializerOptions
): ThreeViewer {
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
	// Report the GPU's max anisotropy so color maps stay sharp at grazing angles. One-time;
	// retroactively upgrades any texture already decoded this session. Injected (see
	// `onMaxAnisotropy`) rather than calling the parse layer's texture cache directly, so the render
	// layer stays usable standalone — hosts that parse meshes wire the two together.
	options?.onMaxAnisotropy?.(renderer.capabilities.getMaxAnisotropy());
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
	// Tagged by addFloor; grabbed here so the near-plane fitter can consult its live visibility.
	const floorMesh = config.floor?.enabled
		? (scene.children.find((child) => child.userData.id === 'floor') ?? null)
		: null;

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
	// Ground-plane normals cap the fit where a ground aid (grid under the camera, floor) would
	// otherwise be clipped at grazing views.
	//
	// Resolved per frame, and only for aids actually VISIBLE: the grid is commonly built up-front so
	// hosts can toggle it, yet started hidden. Since this clamp is the camera's height above the
	// plane, letting a hidden grid contribute drives near→0 at grazing views and craters depth
	// precision (ULP ∝ 1/near) — which shows up as hidden edges punching through solid geometry.
	// applyDefaults always fills `plane` (from the scene up axis); the fallback derives from the same
	// source rather than assuming 'z', so the two can't disagree in a non-Z-up scene.
	const gridPlane = config.grid.plane ?? upToAxis(sceneUp);
	const gridNormal = new THREE.Vector3(
		gridPlane === 'x' ? 1 : 0,
		gridPlane === 'y' ? 1 : 0,
		gridPlane === 'z' ? 1 : 0
	);
	const floorNormal = sceneUp.clone().normalize();
	const groundNormals = (): THREE.Vector3[] => {
		const normals: THREE.Vector3[] = [];
		if (grid?.object.visible) normals.push(gridNormal);
		if (config.floor.enabled && floorMesh?.visible) normals.push(floorNormal);
		return normals;
	};
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
		pipeline.setEdgeFallback(hasSkippedMeshes);
	};

	// The inverse of applyEdges: removes overlays (cancelling in-flight attaches) and stands down
	// the screen-space fallback. Hosts toggling edges off should call this rather than bare
	// removeEdges, or the fallback pass would keep drawing lines for capped meshes.
	const clearEdges = (root: THREE.Object3D) => {
		removeEdges(root);
		pipeline.setEdgeFallback(false);
		requestRender();
	};

	const parent = canvas.parentElement;
	const getCanvasSize = () =>
		parent
			? { width: parent.clientWidth, height: parent.clientHeight }
			: { width: window.innerWidth, height: window.innerHeight };

	// Optional postprocessing pipeline (AO and/or the screen-space edge fallback). The loop reads it
	// through pipeline.get() each frame; when null it uses the plain renderer.render path.
	const pipeline = createPipelineController({
		renderer,
		scene,
		getActiveCamera,
		getCanvasSize,
		pixelRatio,
		config,
		requestRender: () => requestRender()
	});
	pipeline.sync();

	// Runtime lighting/material dials (fill lights, exposure, environment, AO strength, look).
	const appearance = createAppearanceController({
		scene,
		renderer,
		lights,
		config,
		pipeline,
		requestRender: () => requestRender()
	});

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
		() => pipeline.get(),
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
		pipeline.dispose();
		// Stop any in-flight camera tween — its rAF ticks would otherwise keep touching the disposed
		// controls for up to the tween duration after teardown.
		cameraController.dispose();
		controls.dispose();
		renderer.dispose();
		// Free the GL context itself, not just its objects — browsers cap live WebGL contexts
		// (~16) and won't otherwise reclaim this one until GC, which can lag across rapid
		// mount/unmount cycles (e.g. navigating between definitions) and hit that cap.
		renderer.forceContextLoss();

		disposeSceneResources(scene);
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
		setAmbientOcclusion: pipeline.setAmbientOcclusion,
		setLook: appearance.setLook,
		setFillLights: appearance.setFillLights,
		setEnvironmentIntensity: appearance.setEnvironmentIntensity,
		setToneMappingExposure: appearance.setToneMappingExposure,
		setAoIntensity: appearance.setAoIntensity,
		getMaterialAppearance: appearance.getMaterialAppearance,
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
