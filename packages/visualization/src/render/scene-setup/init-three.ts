import * as THREE from 'three';

import { publishMaxAnisotropy } from '../../shared/index.js';
import { createCameraController } from '../camera-controller.js';
import { EDGES_SKIPPED_TRIANGLE_CAP, addEdgesAsync, removeEdges } from '../edges.js';
import { createGrid } from '../grid.js';
import { createLabelLayer, type LabelLayer } from '../label-layer.js';
import { createMeasureTool, type MeasureTool } from '../measure.js';
import { createNearPlaneFitter, type NearPlaneFitter } from '../near-plane.js';
import { SOURCE_USER, appSource, isOwnedBy } from '../scene-ownership.js';
import { computeContentBounds } from '../three-helpers.js';
import { createToolRegistry } from '../tool-registry.js';
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

export const initThree = function (
	canvas: HTMLCanvasElement,
	options?: ThreeInitializerOptions
): ThreeViewer {
	const config = applyDefaults(options || {});

	const sceneUp = config.environment?.sceneUp || defaultUp;

	// Single source of truth for DPR (renderer, resize check, AO pipeline); applyDefaults always
	// sets it, the fallback here is just type narrowing.
	const pixelRatio = config.render.pixelRatio ?? Math.min(window.devicePixelRatio, 2);

	const scene = createScene(config);
	const camera = createCamera(config, canvas);
	// Must happen before OrbitControls/the controller read camera.up (captured at construction), or
	// a Z-up scene orbits and frames as if Y-up.
	camera.up.copy(sceneUp);
	const renderer = setupRenderer(canvas, config, pixelRatio);
	// Published to a shared sink rather than imported, so render/ stays independent of parse/.
	publishMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
	options?.onMaxAnisotropy?.(renderer.capabilities.getMaxAnisotropy());

	const controls = setupControls(camera, canvas, config);

	// Render loop, resize, and raycasting all read through getActiveCamera so 2D/3D stays coherent.
	const cameraController = createCameraController({
		scene,
		perspective: camera,
		controls,
		onActiveCameraChange: () => {},
		up: sceneUp
	});
	const getActiveCamera = () => cameraController.getActiveCamera();

	// HDR decodes asynchronously; setupEnvironment's load callback checks this to drop (and dispose)
	// the texture instead of attaching it to a scene torn down mid-fetch.
	let disposed = false;
	setupEnvironment(scene, renderer, config, () => disposed);
	const lights = setupLighting(scene, config);
	const sunlight = lights.sun;

	const updateShadowBounds = () => {
		if (sunlight) fitShadowToContent(sunlight, computeContentBounds(scene));
	};

	if (config.floor?.enabled) {
		addFloor(scene, config);
	}
	// So the near-plane fitter below can consult the floor's live visibility.
	const floorMesh = config.floor?.enabled
		? (scene.children.find((child) => child.userData.id === 'floor') ?? null)
		: null;

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

	const updateGridScale = () => {
		if (grid) grid.fitToContent(computeContentBounds(scene));
	};

	const gizmo = config.gizmo.enabled
		? createViewGizmo({ camera, domElement: canvas, controller: cameraController })
		: null;

	// Only VISIBLE ground aids feed the near-plane fitter's clamp: the grid is commonly built hidden
	// so hosts can toggle it, and the clamp is the camera's height above the plane — a hidden grid
	// would still drive near→0 at grazing views and crater depth precision, punching hidden edges
	// through geometry.
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

	// Built unconditionally: measure was the first consumer, but any tool or app annotating the
	// scene needs it, and gating it behind measure.enabled left them with no way to get one.
	const labelContainer = canvas.parentElement ?? canvas;
	const labelLayer: LabelLayer = createLabelLayer(labelContainer, scene);
	const measureTool: MeasureTool | null = config.measure.enabled
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

	// Built-ins register at the priorities documented on ToolRegistration, so a host tool can slot
	// above or below them. Listeners are attached unconditionally — a tool can register at any time.
	const tools = createToolRegistry();
	if (measureTool) tools.register({ id: 'measure', tool: measureTool, priority: 0 });
	if (gizmo) tools.register({ id: 'gizmo', tool: gizmo, priority: -100 });

	// A drag to orbit/pan ends with a `click` on mouseup; without this guard that release would be
	// mistaken for a measurement point.
	const DRAG_SLOP_PX = 5;
	let pressX = 0;
	let pressY = 0;
	const handlePointerDown = (event: MouseEvent) => {
		pressX = event.clientX;
		pressY = event.clientY;
	};
	const wasDrag = (event: MouseEvent) =>
		Math.hypot(event.clientX - pressX, event.clientY - pressY) > DRAG_SLOP_PX;

	// Capture-phase so tools see the click before bubble-phase selection; the first to claim it
	// wins, and stopImmediatePropagation keeps selection from also firing.
	const handleToolClick = (event: MouseEvent) => {
		if (wasDrag(event)) return;
		if (tools.handleClick(event)) event.stopImmediatePropagation();
	};
	canvas.addEventListener('mousedown', handlePointerDown, { capture: true });
	canvas.addEventListener('click', handleToolClick, { capture: true });

	// Passive: moves only drive previews, never consume, so they can't interfere with orbit/pan.
	const handleToolMove = (event: MouseEvent) => tools.handleMove(event);
	canvas.addEventListener('mousemove', handleToolMove, { passive: true });

	// Rebound to the animation loop's real invalidate once it's created below.
	let requestRender: () => void = () => {};

	// Applies regardless of edges.enabled — an explicit call should never be silently ignored.
	// Meshes over the triangle cap switch the screen-space edge fallback on; a later solve without
	// such meshes switches it back off.
	const applyEdges = (root: THREE.Object3D) => {
		void addEdgesAsync(root, {
			color: config.edges.color,
			darken: config.edges.darken,
			width: config.edges.width,
			thresholdAngle: config.edges.thresholdAngle,
			distanceFade: config.edges.distanceFade,
			maxTriangles: config.edges.maxTriangles,
			maxSegments: config.edges.maxSegments
		}).then(() => {
			updateEdgeFallback(root);
			requestRender(); // async attach may land after the solve's own repaint
		});
	};

	const updateEdgeFallback = (root: THREE.Object3D) => {
		if (config.edges.screenSpaceFallback === false) return;
		let hasSkippedMeshes = false;
		root.traverse((object) => {
			if (object.userData?.edgesSkipped === EDGES_SKIPPED_TRIANGLE_CAP) hasSkippedMeshes = true;
		});
		pipeline.setEdgeFallback(hasSkippedMeshes);
	};

	// Also stands down the screen-space fallback — bare removeEdges alone would keep drawing lines
	// for capped meshes.
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

	const appearance = createAppearanceController({
		scene,
		renderer,
		lights,
		config,
		pipeline,
		requestRender: () => requestRender()
	});

	const {
		animate,
		dispose: disposeAnimation,
		invalidate,
		renderNow
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

	// Initial fit for geometry already present; hosts loading more later via updateScene should
	// call these again.
	updateShadowBounds();
	updateGridScale();

	const captureImage = (type = 'image/png', quality?: number): Promise<Blob | null> => {
		// Draw and read in the same task: without preserveDrawingBuffer the colour buffer is gone
		// once the browser composites, and a deferred toBlob returns a blank image.
		renderNow();
		return new Promise((resolve) => renderer.domElement.toBlob(resolve, type, quality));
	};

	const addUserGeometry = (object: THREE.Object3D, appId?: string) => {
		object.userData.source = appId === undefined ? SOURCE_USER : appSource(appId);
		scene.add(object);
		requestRender();
	};

	const removeUserGeometry = (object: THREE.Object3D) => {
		object.removeFromParent();
		disposeObjectTree(object);
		requestRender();
	};

	const clearUserGeometry = (appId?: string) => {
		// Snapshot first: removeFromParent would mutate scene.children mid-iteration otherwise.
		const owned = scene.children.filter((child) => isOwnedBy(child, appId));
		owned.forEach((object) => {
			object.removeFromParent();
			disposeObjectTree(object);
		});
		requestRender();
	};

	const dispose = () => {
		// Idempotent: a second call would re-run forceContextLoss() on an already-lost context and
		// throw (double-dispose happens naturally under React StrictMode).
		if (disposed) return;
		disposed = true;
		disposeAnimation();
		eventHandlers.dispose();
		canvas.removeEventListener('mousedown', handlePointerDown, { capture: true });
		canvas.removeEventListener('click', handleToolClick, { capture: true });
		canvas.removeEventListener('mousemove', handleToolMove);
		measureTool?.dispose();
		labelLayer?.dispose();
		gizmo?.dispose();
		grid?.dispose();
		pipeline.dispose();
		// Stops any in-flight camera tween — its rAF ticks would otherwise keep touching the
		// disposed controls after teardown.
		cameraController.dispose();
		controls.dispose();
		renderer.dispose();
		// Frees the GL context itself: browsers cap live WebGL contexts (~16), and otherwise it won't
		// be reclaimed until GC, which can lag across rapid mount/unmount cycles.
		renderer.forceContextLoss();

		disposeSceneResources(scene);

		// Cross-solve caches (parse/'s, reached via a registry rather than an import — layer rule)
		// outlive any single scene but not the GL context just destroyed. Refcounted: only the last
		// live viewer actually frees, and this must run after the scene sweep above.
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
		labelLayer,
		tools,
		applyEdges,
		clearEdges,
		invalidate,
		captureImage,
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
