<script lang="ts">
	import { APP_DEFAULTS } from '../../constants';
	import { onMount, untrack } from 'svelte';
	import {
		initThree,
		updateScene,
		LOOKS,
		LOOK_PRESETS,
		type Look,
		type ThreeInitializerOptions,
		type CameraController,
		type CameraProjection,
		type MeasureTool,
		type ViewPreset,
		type Grid,
		type ThreeViewer
	} from '@selvajs/visualization/render';
	import {
		Maximize,
		Minimize,
		Camera,
		Layers,
		Settings2,
		Box,
		Square,
		Frame,
		Ruler,
		Grid3x3,
		Palette,
		Spline
	} from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import { createSceneOutliner, type SceneOutliner } from '@selvajs/visualization/scene';
	import { clearGeometryCache } from '@selvajs/visualization/parse';
	import SceneManager from './SceneManager.svelte';
	import MeshMetadataPanel from './MeshMetadataPanel.svelte';
	import * as Resizable from '$lib/components/primitives/resizable/index.js';
	import * as DropdownMenu from '$lib/components/primitives/dropdown-menu/index.js';
	import { Button } from '$lib/components/primitives/button/index.js';
	import type { Locale } from '$lib/i18n/messages';
	import { layerLocaleContext } from '$lib/i18n/localeContext.svelte';
	import { saveBlob } from '$lib/utils/host-files';

	export interface ViewerConfig {
		showScreenshotButton?: boolean;
		showFullscreenButton?: boolean;
		showSceneManager?: boolean;
		showToolsMenu?: boolean;
		showGridToggle?: boolean;
		showDisplayMenu?: boolean;
		enableMeshClick?: boolean;
		backgroundColor?: string;
		/** Initial state of the edge overlay and its display-menu checkmark. Default false. */
		showEdges?: boolean;
	}

	interface Props {
		meshes: any[];
		isFullscreen?: boolean;
		/** Shows a progress bar along the top edge. Pass a delayed flag (`createSolvingIndicator`). */
		isSolving?: boolean;
		/** Dims the stale result while a long solve runs. */
		isSlow?: boolean;
		isBlurred?: boolean;
		drawerOpen?: boolean;
		viewerConfig?: ViewerConfig;
		/** Shown as a watermark in the bottom-right corner. */
		logoUrl?: string;
		/**
		 * Hands the live three.js viewer to the host once the canvas is up, for apps drawing their
		 * own content. Return a cleanup function to tear down what you added; it runs before the
		 * viewer disposes. Anything added outside a solve needs `viewer.invalidate()` to repaint —
		 * the render loop is on-demand.
		 */
		onViewerReady?: (viewer: ThreeViewer) => void | (() => void);
		/**
		 * UI language for the viewer's own chrome. Omitted, the viewer reads the nearest locale
		 * context. Does not translate Grasshopper-sourced names/metadata.
		 */
		lang?: Locale;
	}

	const defaultViewerConfig: Required<ViewerConfig> = {
		showScreenshotButton: true,
		showFullscreenButton: true,
		showSceneManager: true,
		showToolsMenu: true,
		showGridToggle: true,
		showDisplayMenu: true,
		enableMeshClick: true,
		backgroundColor: '#E6E6E6',
		showEdges: false
	};

	let {
		meshes,
		isFullscreen = $bindable(false),
		isSolving = false,
		isSlow = false,
		isBlurred = false,
		drawerOpen = false,
		viewerConfig = {},
		logoUrl,
		onViewerReady,
		lang
	}: Props = $props();

	const config = $derived({ ...defaultViewerConfig, ...viewerConfig });

	// A getter, not a value: it is re-read reactively, so changing `lang` updates the chrome live.
	const locale = layerLocaleContext(() => lang);
	const t = $derived(locale.messages);

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene | null = $state(null);
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let cameraController: CameraController | null = null;
	let measureTool: MeasureTool | null = null;
	let grid: Grid | null = null;
	let applyEdges: ThreeViewer['applyEdges'] | null = null;
	let clearEdges: ThreeViewer['clearEdges'] | null = null;
	let invalidate: (() => void) | null = null;
	let captureImage: ThreeViewer['captureImage'] | null = null;
	let setLook: ((look: Look) => void) | null = null;
	let updateGridScale: (() => void) | null = null;
	let updateShadowBounds: (() => void) | null = null;
	let fitToView: (() => void) | null = null;
	let clearSelection: (() => void) | null = null;
	let viewerInitialized = false;
	let sceneVersion = $state(0);
	let hideButton = $state(false);
	let sceneManagerOpen = $state(false);

	// The outliner lives here, not in <SceneManager>: that component mounts only while its panel is
	// open, and hidden objects must stay hidden — and be re-hidden after each solve — while it is closed.
	const hiddenObjects = new SvelteSet<string>();
	const selectedObjects = new SvelteSet<string>();
	const collapsedLayers = new SvelteSet<string>();
	let outliner: SceneOutliner | null = $state(null);
	let projection: CameraProjection = $state('perspective');
	let measureActive = $state(false);
	let gridVisible = $state(false);
	let renderStyle: Look = $state('technical');
	// Seeded once, then owned by the menu toggle.
	let edgesVisible = $state(untrack(() => viewerConfig.showEdges) ?? defaultViewerConfig.showEdges);
	let selectedMeshMetadata: Record<string, any> | null = $state(null);
	let selectedMeshName: string | null = $state(null);

	// Derived from LOOKS so a look added in @selvajs/visualization shows up here with no edit,
	// under its capitalised name until it gets a message.
	const lookLabels = $derived<Partial<Record<Look, string>>>({
		technical: t.lookTechnical,
		studio: t.lookStudio,
		showcase: t.lookShowcase,
		arctic: t.lookArctic,
		xray: t.lookXray,
		lineart: t.lookLineart,
		wireframe: t.lookWireframe
	});
	const styleOptions = $derived<{ look: Look; label: string }[]>(
		LOOKS.map((look) => ({
			look,
			label: lookLabels[look] ?? look.charAt(0).toUpperCase() + look.slice(1)
		}))
	);

	const VIEW_PRESETS: { preset: ViewPreset; label: () => string }[] = [
		{ preset: 'top', label: () => t.viewTop },
		{ preset: 'front', label: () => t.viewFront },
		{ preset: 'right', label: () => t.viewRight },
		{ preset: 'back', label: () => t.viewBack },
		{ preset: 'left', label: () => t.viewLeft },
		{ preset: 'bottom', label: () => t.viewBottom },
		{ preset: 'iso', label: () => t.viewIso }
	];

	// Hide button instantly when expanding, show after animation when collapsing
	$effect(() => {
		if (drawerOpen) {
			hideButton = true;
		} else {
			const timer = setTimeout(() => {
				hideButton = false;
			}, APP_DEFAULTS.TIMEOUTS.DRAWER_ANIMATION_MS);
			return () => clearTimeout(timer);
		}
	});

	onMount(() => {
		if (!canvas) return;

		// Only what differs from the library defaults. Sunlight, shadows and AO are left ON (the
		// library default) and their strength comes from the look — with IBL alone every face of a
		// box lights nearly equally and the model reads as a flat white silhouette.
		const opts: ThreeInitializerOptions = {
			look: renderStyle,
			environment: { backgroundColor: config.backgroundColor },
			grid: { enabled: config.showToolsMenu && config.showGridToggle },
			measure: { enabled: config.showToolsMenu },
			events: {
				// Fires before onMeshMetadataClicked, so picking an object without metadata closes the
				// previous object's panel instead of leaving it describing the wrong thing.
				onObjectSelected: closeMetadata,
				onBackgroundClicked: closeMetadata,
				onMeshMetadataClicked: config.enableMeshClick
					? (metadata: Record<string, unknown>) => {
							if (hasUsefulMetadata(metadata)) {
								selectedMeshMetadata = metadata;
								selectedMeshName = String(metadata?.name ?? '') || t.objectFallbackName;
							}
						}
					: undefined
			}
		};

		const init = initThree(canvas, opts);
		scene = init.scene;
		outliner = createSceneOutliner(init.scene, {
			sets: { hidden: hiddenObjects, selected: selectedObjects, collapsed: collapsedLayers }
		});
		camera = init.camera;
		controls = init.controls;
		cameraController = init.cameraController;
		measureTool = init.measureTool;
		grid = init.grid;
		grid?.setVisible(gridVisible);
		applyEdges = init.applyEdges;
		clearEdges = init.clearEdges;
		invalidate = init.invalidate;
		captureImage = init.captureImage;
		setLook = init.setLook;
		updateGridScale = init.updateGridScale;
		updateShadowBounds = init.updateShadowBounds;
		fitToView = init.fitToView;
		clearSelection = init.clearSelection;
		projection = init.cameraController.getProjection();

		// Untracked so the host reading `meshes` or config inside its setup can't re-run onMount's teardown.
		const hostCleanup = untrack(() => onViewerReady?.(init));

		return () => {
			// Before dispose, so the host can still remove its own objects from a live scene.
			hostCleanup?.();
			// Also frees the GL context: a second forceContextLoss() here hits an already-lost one.
			init.dispose();
			// Parsed geometry outlives the viewer otherwise: the cache is page-wide.
			clearGeometryCache();
		};
	});

	function toggleProjection() {
		if (!cameraController) return;
		projection = cameraController.toggleProjection();
	}

	function setView(preset: ViewPreset) {
		cameraController?.setView(preset);
	}

	function toggleMeasure() {
		if (!measureTool) return;
		measureActive = !measureActive;
		measureTool.setEnabled(measureActive);
	}

	function toggleGrid() {
		if (!grid) return;
		gridVisible = !gridVisible;
		grid.setVisible(gridVisible);
		invalidate?.();
	}

	// Edges the lineart look switched on, so leaving it can put the user's own choice back rather
	// than stranding them with overlays they never asked for.
	let edgesBeforeLineDrawing: boolean | null = null;

	function setRenderStyle(look: Look) {
		if (!setLook || look === renderStyle) return;
		const wasLineDrawing = LOOK_PRESETS[renderStyle].requiresEdges === true;
		renderStyle = look;
		setLook(look);

		// A look never drives the overlay itself; honouring `requiresEdges` is the host's call. Without
		// edges lineart is blank white shapes, so entering it forces them on.
		if (LOOK_PRESETS[look].requiresEdges) {
			if (!wasLineDrawing) edgesBeforeLineDrawing = edgesVisible;
			if (!edgesVisible) {
				edgesVisible = true;
			} else if (!wasLineDrawing && scene) {
				// Already-attached overlays carry the old fade setting, and addEdges skips a mesh that
				// has one — so they have to go before the un-faded pass can replace them.
				clearEdges?.(scene);
			}
			applyEdgeState();
		} else if (wasLineDrawing && edgesBeforeLineDrawing !== null) {
			edgesVisible = edgesBeforeLineDrawing;
			// Rebuild either way: staying on means swapping the un-faded overlays back for faded ones.
			if (edgesVisible && scene) clearEdges?.(scene);
			applyEdgeState();
			edgesBeforeLineDrawing = null;
		} else if (edgesVisible && scene) {
			// Neither look is a line drawing, but an overlay's colour is derived from its mesh's
			// material — which `setLook` just repainted. addEdges skips meshes that already have an
			// overlay, so without a rebuild the edges keep the previous look's colour.
			clearEdges?.(scene);
			applyEdgeState();
		}
	}

	// Meshes past the overlay budget get the screen-space fallback instead, and that pass thresholds
	// a depth/normal discontinuity to decide what is an edge — so a shallow crease sitting near the
	// cutoff flips on and off as the camera turns a degree. Tolerable as a hint over a shaded model;
	// in a line drawing it is the picture itself flickering. Raised far enough that a building model
	// gets real overlays throughout: they cost draw calls, but they are stable under orbit.
	const LINE_ART_MAX_OVERLAYS = 20_000;

	// Edge colour is normally derived per mesh from that mesh's own material, darkened. lineart
	// repaints every material near-white, so a derived edge lands at rgb(62,62,62) or lighter — and
	// worse, `setLook` and `applyEdges` are independent, so whether the derivation sees the white
	// override or the model's original colours depends on which ran last. That is the real source of
	// the "edges look different every time" behaviour. Forcing a colour makes it deterministic.
	const LINE_ART_EDGE_COLOR = 0x1a1d21;

	// The density fade sets opacity per overlay, so a finely-detailed mesh fades as a whole and its
	// long silhouette edges go with it — in a line drawing that erases the only thing on screen, and
	// it recomputes per frame, so edges pop while orbiting. Shaded looks keep it: there it just
	// softens outlines on a model you can still see.
	function edgeOverrides() {
		return LOOK_PRESETS[renderStyle].requiresEdges
			? {
					distanceFade: false,
					maxOverlays: LINE_ART_MAX_OVERLAYS,
					color: LINE_ART_EDGE_COLOR
				}
			: undefined;
	}

	// `applyEdges` is idempotent per mesh, so the repeated calls after each solve add no duplicate
	// overlays; `clearEdges` is its inverse.
	function applyEdgeState() {
		if (!scene) return;
		if (edgesVisible) applyEdges?.(scene, edgeOverrides());
		else clearEdges?.(scene);
	}

	function toggleEdges() {
		edgesVisible = !edgesVisible;
		// Toggling by hand inside lineart overrides what that look forced, so the pre-look value is
		// stale — leaving the look must not undo the user's more recent explicit choice.
		if (LOOK_PRESETS[renderStyle].requiresEdges) edgesBeforeLineDrawing = null;
		applyEdgeState();
	}

	$effect(() => {
		if (scene && camera && controls) {
			updateScene(scene, meshes, camera, controls, viewerInitialized);
			// Untracked because toggleEdges() already handles the toggle directly — reading
			// `edgesVisible` tracked here would re-trigger a full solve.
			untrack(() => {
				// The new meshes carry the materials the parser built, so a look that overrides them
				// (arctic, x-ray) has to be re-applied or the solve silently reverts to shaded.
				setLook?.(renderStyle);
				// updateScene discarded the previous solve's overlays along with its content.
				if (edgesVisible) applyEdges?.(scene!, edgeOverrides());
				// Rescale the grid so cells and fade match the new content's extent.
				updateGridScale?.();
				// The shadow frustum is sized to scene content, so it has to follow the new geometry —
				// left at the old extent, shadows go blocky or fall outside the map entirely.
				updateShadowBounds?.();
				// The rebuild un-hid everything; the outliner keys hidden state on Grasshopper
				// identity, not on the instances just discarded, so it can re-hide it.
				outliner?.applyTo();
				sceneVersion++;
				// Repaint now rather than on the render loop's safety interval.
				invalidate?.();
			});

			if (!viewerInitialized && meshes.length > 0) {
				viewerInitialized = true;
			}
		}
	});

	function closeMetadata() {
		selectedMeshMetadata = null;
		selectedMeshName = null;
	}

	function dismissMetadata() {
		closeMetadata();
		clearSelection?.();
		invalidate?.();
	}

	// The panel describes an object from the previous solve once new meshes arrive.
	$effect(() => {
		void meshes;
		untrack(closeMetadata);
	});

	// Dialogs portal to <body>, so one opened over the fullscreen viewer needs lifting above it.
	$effect(() => {
		document.body.toggleAttribute('data-viewer-fullscreen', isFullscreen);
		return () => document.body.removeAttribute('data-viewer-fullscreen');
	});

	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
	}

	function hasUsefulMetadata(metadata: Record<string, any>): boolean {
		if (!metadata) return false;

		if (metadata.metadata && typeof metadata.metadata === 'object') {
			const nestedMetadata = metadata.metadata;
			return Object.keys(nestedMetadata).length > 0;
		}

		const EXCLUDED_KEYS = new Set([
			'name',
			'layer',
			'id',
			'vertexCount',
			'faceCount',
			'vertexOffset',
			'faceOffset'
		]);
		const usefulEntries = Object.entries(metadata).filter(([key]) => !EXCLUDED_KEYS.has(key));
		return usefulEntries.length > 0;
	}

	async function downloadScreenshot() {
		const blob = await captureImage?.();
		if (!blob) return;

		const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
		await saveBlob(blob, `viewer-${timestamp}.png`);
	}
</script>

<div
	class="min-h-64 sm:min-h-96 lg:min-h-125 relative h-full flex-1 border {isFullscreen
		? 'fullscreen-viewer'
		: 'overflow-hidden rounded-lg'}"
>
	<Resizable.PaneGroup direction="horizontal" class="h-full w-full">
		<!-- `defaultSize` must sum to 100 across the live panes. Panes register a frame before the
		     group recomputes its layout, so a sum of 115 renders one frame at the raw flex-grow ratio
		     and is then renormalized — and if the recompute short-circuits on an equal layout, the
		     scene pane keeps a sliver of its intended width. Hence 85 + 15, and the explicit id/order
		     so a conditionally-rendered pane keeps its slot. -->
		<Resizable.Pane id="viewport" order={1} defaultSize={sceneManagerOpen ? 85 : 100} minSize={40}>
			<div class="relative h-full w-full touch-none">
				<!-- Mesh count of the geometry currently in the scene. The canvas itself is opaque to
				     the DOM, so this is the only observable proof a solve's geometry decoded and
				     rendered; e2e asserts on it. -->
				<canvas
					class="viewer-canvas block h-full w-full select-none"
					data-testid="viewer-canvas"
					data-mesh-count={meshes.length}
					bind:this={canvas}
				></canvas>

				<div
					class="inset-0 blur-overlay absolute z-20 {isBlurred
						? 'blur-overlay-active'
						: 'blur-overlay-inactive'}"
				></div>

				<!-- The last result stays sharp while the next one solves: blurring it on every
				     solve hides the model the user is adjusting. -->
				{#if isSolving}
					<div
						class="inset-x-0 top-0 h-0.5 animate-in fade-in pointer-events-none absolute z-20 overflow-hidden bg-primary/20 duration-200"
						aria-hidden="true"
					>
						<div class="solve-bar h-full w-1/3 bg-primary"></div>
					</div>
				{/if}
				{#if isSlow}
					<div
						class="inset-0 animate-in fade-in pointer-events-none absolute z-10 bg-background/25 duration-500"
					></div>
				{/if}

				{#if logoUrl}
					<!-- pointer-events:none so it never intercepts canvas drags. -->
					<div
						class="right-4 bottom-4 pointer-events-none absolute z-20 {hideButton
							? 'opacity-0'
							: ''}"
					>
						<img
							src={logoUrl}
							alt=""
							class="h-10 max-w-40 drop-shadow-sm sm:h-14 sm:max-w-56 w-auto object-contain opacity-80"
						/>
					</div>
				{/if}

				{#if selectedMeshMetadata}
					<MeshMetadataPanel
						metadata={selectedMeshMetadata}
						meshName={selectedMeshName}
						onClose={dismissMetadata}
						class="top-3 right-3 left-3 sm:right-auto sm:max-h-2/3 sm:w-72 absolute z-30 max-h-1/2"
					/>
				{/if}

				{#if config.showToolsMenu}
					<div
						class="left-4 bottom-4 gap-2 *:shadow-lg absolute z-50 flex items-center *:rounded-md {hideButton
							? 'pointer-events-none opacity-0'
							: ''}"
					>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="overlay"
										size="icon-lg"
										title={t.toolsMenu}
										aria-label={t.toolsMenu}
									>
										<Settings2 />
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<!-- Above the fullscreen viewer, which sits at z-index 10000. -->
							<DropdownMenu.Content sideOffset={6} class="min-w-44 z-10001 w-auto">
								<DropdownMenu.Item onSelect={toggleProjection}>
									{#if projection === 'perspective'}
										<Square />
										{t.switchToOrthographic}
									{:else}
										<Box />
										{t.switchToPerspective}
									{/if}
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => fitToView?.()}>
									<Frame />
									{t.fitToView}
								</DropdownMenu.Item>

								<DropdownMenu.Sub>
									<DropdownMenu.SubTrigger>
										<Box />
										{t.views}
									</DropdownMenu.SubTrigger>
									<DropdownMenu.SubContent class="z-10001">
										{#each VIEW_PRESETS as { preset, label } (preset)}
											<DropdownMenu.Item onSelect={() => setView(preset)}
												>{label()}</DropdownMenu.Item
											>
										{/each}
									</DropdownMenu.SubContent>
								</DropdownMenu.Sub>

								{#if config.showDisplayMenu}
									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger>
											<Palette />
											{t.display}
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent class="min-w-40 z-10001">
											<DropdownMenu.RadioGroup
												value={renderStyle}
												onValueChange={(look) => setRenderStyle(look as typeof renderStyle)}
											>
												{#each styleOptions as { look, label } (look)}
													<DropdownMenu.RadioItem value={look} closeOnSelect={false}>
														{label}
													</DropdownMenu.RadioItem>
												{/each}
											</DropdownMenu.RadioGroup>
											<DropdownMenu.Separator />
											<DropdownMenu.CheckboxItem
												checked={edgesVisible}
												onCheckedChange={toggleEdges}
											>
												<Spline />
												{t.edges}
											</DropdownMenu.CheckboxItem>
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>
								{/if}

								<DropdownMenu.CheckboxItem checked={measureActive} onCheckedChange={toggleMeasure}>
									<Ruler />
									{t.measure}
								</DropdownMenu.CheckboxItem>

								{#if config.showGridToggle}
									<DropdownMenu.CheckboxItem checked={gridVisible} onCheckedChange={toggleGrid}>
										<Grid3x3 />
										{t.grid}
									</DropdownMenu.CheckboxItem>
								{/if}

								{#if config.showSceneManager || config.showScreenshotButton || config.showFullscreenButton}
									<DropdownMenu.Separator />
								{/if}

								{#if config.showSceneManager}
									<DropdownMenu.CheckboxItem
										checked={sceneManagerOpen}
										onCheckedChange={() => (sceneManagerOpen = !sceneManagerOpen)}
									>
										<Layers />
										{t.sceneManager}
									</DropdownMenu.CheckboxItem>
								{/if}

								{#if config.showScreenshotButton}
									<DropdownMenu.Item onSelect={downloadScreenshot}>
										<Camera />
										{t.screenshot}
									</DropdownMenu.Item>
								{/if}

								{#if config.showFullscreenButton}
									<DropdownMenu.Item onSelect={toggleFullscreen}>
										{#if isFullscreen}
											<Minimize />
											{t.exitFullscreen}
										{:else}
											<Maximize />
											{t.fullscreen}
										{/if}
									</DropdownMenu.Item>
								{/if}
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						<!-- Touch has no F key, and fit-to-view is the way back from a framed part. -->
						<div class="hidden pointer-coarse:block">
							<Button
								variant="overlay"
								size="icon-lg"
								title={t.fitToView}
								aria-label={t.fitToView}
								onclick={() => fitToView?.()}
							>
								<Frame />
							</Button>
						</div>
					</div>
				{/if}
			</div>
		</Resizable.Pane>

		{#if sceneManagerOpen && scene && outliner}
			<Resizable.Handle withHandle />
			<Resizable.Pane id="scene-manager" order={2} defaultSize={15} minSize={8} maxSize={30}>
				<SceneManager {outliner} {sceneVersion} onVisibilityChange={() => invalidate?.()} />
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
</div>

<style>
	:global([data-viewer-fullscreen] [data-slot='dialog-content']),
	:global([data-viewer-fullscreen] [data-slot='dialog-overlay']) {
		z-index: 10001;
	}

	.fullscreen-viewer {
		position: fixed;
		inset: 0;
		z-index: 10000;
		border-radius: 0 !important;
	}

	/* A long press on touch otherwise selects the canvas as an image and opens the save/copy callout. */
	.viewer-canvas {
		-webkit-touch-callout: none;
		-webkit-tap-highlight-color: transparent;
	}

	.solve-bar {
		animation: solve-bar 1.2s cubic-bezier(0.65, 0, 0.35, 1) infinite;
	}

	@keyframes solve-bar {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(300%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.solve-bar {
			animation: none;
			width: 100%;
			opacity: 0.6;
		}
	}

	.blur-overlay {
		pointer-events: none;
	}

	.blur-overlay-active {
		animation: blur-in 0.35s cubic-bezier(0.32, 0.72, 0, 1) forwards;
	}

	.blur-overlay-inactive {
		animation: blur-out 0.35s cubic-bezier(0.32, 0.72, 0, 1) forwards;
	}

	@keyframes blur-in {
		from {
			backdrop-filter: blur(0px);
		}
		to {
			backdrop-filter: blur(5px);
		}
	}

	@keyframes blur-out {
		from {
			backdrop-filter: blur(5px);
		}
		to {
			backdrop-filter: blur(0px);
		}
	}
</style>
