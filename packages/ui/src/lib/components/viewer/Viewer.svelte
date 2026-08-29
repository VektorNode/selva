<script lang="ts">
	import { APP_DEFAULTS } from '../../constants';
	import { onMount, untrack } from 'svelte';
	import {
		initThree,
		updateScene,
		LOOKS,
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
		Check,
		ChevronRight,
		Palette,
		Spline
	} from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import { SvelteSet } from 'svelte/reactivity';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import { createSceneOutliner, type SceneOutliner } from '@selvajs/visualization/scene';
	import SceneManager from './SceneManager.svelte';
	import MeshMetadataDialog from './MeshMetadataDialog.svelte';
	import * as Resizable from '$lib/components/primitives/resizable/index.js';
	import type { Locale } from '$lib/i18n/messages';
	import { setLocaleContext, getLocaleContext } from '$lib/i18n/localeContext.svelte';

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
		isSolving?: boolean;
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
		isBlurred = false,
		drawerOpen = false,
		viewerConfig = {},
		logoUrl,
		onViewerReady,
		lang
	}: Props = $props();

	const config = $derived({ ...defaultViewerConfig, ...viewerConfig });

	// Read the host's locale before overriding it for our subtree.
	const hostLocale = getLocaleContext();

	// A getter, not a value: it is re-read reactively, so changing `lang` updates the chrome live.
	setLocaleContext(() => lang ?? hostLocale.locale);
	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene | null = $state(null);
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let cameraController: CameraController | null = null;
	let measureTool: MeasureTool | null = null;
	let grid: Grid | null = null;
	let applyEdges: ((root: THREE.Object3D) => void) | null = null;
	let clearEdges: ((root: THREE.Object3D) => void) | null = null;
	let invalidate: (() => void) | null = null;
	let captureImage: ThreeViewer['captureImage'] | null = null;
	let setLook: ((look: Look) => void) | null = null;
	let updateGridScale: (() => void) | null = null;
	let updateShadowBounds: (() => void) | null = null;
	let fitToView: (() => void) | null = null;
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

	// Derived from LOOKS so adding a look in @selvajs/visualization shows up here with no edit; the
	// map only overrides the names that don't survive capitalisation ('xray' → 'X-Ray').
	const LOOK_LABELS: Partial<Record<Look, string>> = { xray: 'X-Ray' };
	const STYLE_OPTIONS: { look: Look; label: string }[] = LOOKS.map((look) => ({
		look,
		label: LOOK_LABELS[look] ?? look.charAt(0).toUpperCase() + look.slice(1)
	}));

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
		projection = init.cameraController.getProjection();

		const renderer = init.renderer;

		// Untracked so the host reading `meshes` or config inside its setup can't re-run onMount's teardown.
		const hostCleanup = untrack(() => onViewerReady?.(init));

		return () => {
			// Before dispose, so the host can still remove its own objects from a live scene.
			hostCleanup?.();
			init.dispose();
			// `{#key definitionKey}` recreates the canvas + WebGLRenderer + GL context
			// on every definition switch; browsers cap live contexts (~16). Explicitly
			// drop this one so the GPU-side context is released now rather than at GC.
			renderer.forceContextLoss();
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

	function setRenderStyle(look: Look) {
		if (!setLook || look === renderStyle) return;
		renderStyle = look;
		setLook(look);
	}

	// `applyEdges` is idempotent per mesh, so the repeated calls after each solve add no duplicate
	// overlays; `clearEdges` is its inverse.
	function applyEdgeState() {
		if (!scene) return;
		if (edgesVisible) applyEdges?.(scene);
		else clearEdges?.(scene);
	}

	function toggleEdges() {
		edgesVisible = !edgesVisible;
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
				if (edgesVisible) applyEdges?.(scene!);
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

		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
		link.href = url;
		link.download = `viewer-${timestamp}.png`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	}
</script>

<div
	class="min-h-64 sm:min-h-96 lg:min-h-125 relative h-full flex-1 border {isFullscreen
		? 'fullscreen-viewer'
		: 'overflow-hidden rounded-[0.625rem]'}"
>
	<Resizable.PaneGroup direction="horizontal" class="h-full w-full">
		<!-- `defaultSize` must sum to 100 across the live panes. Panes register a frame before the
		     group recomputes its layout, so a sum of 115 renders one frame at the raw flex-grow ratio
		     and is then renormalized — and if the recompute short-circuits on an equal layout, the
		     scene pane keeps a sliver of its intended width. Hence 85 + 15, and the explicit id/order
		     so a conditionally-rendered pane keeps its slot. -->
		<Resizable.Pane id="viewport" order={1} defaultSize={sceneManagerOpen ? 85 : 100} minSize={40}>
			<div class="relative h-full w-full" style="touch-action: none;">
				<!-- Mesh count of the geometry currently in the scene. The canvas itself is opaque to
				     the DOM, so this is the only observable proof a solve's geometry decoded and
				     rendered; e2e asserts on it. -->
				<canvas
					class="block h-full w-full"
					data-testid="viewer-canvas"
					data-mesh-count={meshes.length}
					bind:this={canvas}
				></canvas>

				<div
					class="inset-0 blur-overlay absolute z-20 {isBlurred
						? 'blur-overlay-active'
						: 'blur-overlay-inactive'}"
				></div>

				{#if isSolving}
					<div
						class="inset-0 absolute z-10 animate-[selva-viewer-fade-in_0.2s_ease-out] backdrop-blur-[2px] transition-all duration-300"
					></div>
				{/if}

				{#if logoUrl}
					<!-- Bottom offset matches the tools menu so it clears the mobile drawer handle.
					     Always pointer-events:none so it never intercepts canvas drags. -->
					<div
						class="right-4 {isFullscreen ? 'bottom-4' : 'bottom-16 sm:bottom-4'} absolute z-20"
						style={hideButton
							? 'opacity: 0; pointer-events: none;'
							: 'opacity: 1; pointer-events: none;'}
					>
						<img
							src={logoUrl}
							alt=""
							class="h-10 max-w-40 drop-shadow-sm sm:h-14 sm:max-w-56 w-auto object-contain opacity-80"
						/>
					</div>
				{/if}

				{#if config.showToolsMenu}
					{@const itemClass =
						'gap-2 px-2 py-1.5 text-sm flex cursor-pointer select-none items-center rounded-sm outline-none transition-colors hover:bg-muted focus:bg-muted'}
					<div
						class="left-4 {isFullscreen
							? 'bottom-4'
							: 'bottom-16 sm:bottom-4'} absolute z-50 flex items-center"
						style={hideButton
							? 'opacity: 0; pointer-events: none;'
							: 'opacity: 1; pointer-events: auto;'}
					>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger
								class="h-10 w-10 shadow-lg hover:shadow-xl flex items-center justify-center rounded-lg border border-border bg-card/90 transition-all hover:bg-card active:scale-95 data-[state=open]:bg-secondary/60"
								title={t.toolsMenu}
								aria-label={t.toolsMenu}
							>
								<Settings2 class="h-5 w-5 text-card-foreground" />
							</DropdownMenu.Trigger>
							<DropdownMenu.Portal>
								<DropdownMenu.Content
									sideOffset={6}
									align="start"
									class="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 min-w-44 p-1 shadow-md z-10001 rounded-md border bg-popover text-popover-foreground"
								>
									<DropdownMenu.Item class={itemClass} onSelect={toggleProjection}>
										{#if projection === 'perspective'}
											<Square class="h-4 w-4" />
											{t.switchToOrthographic}
										{:else}
											<Box class="h-4 w-4" />
											{t.switchToPerspective}
										{/if}
									</DropdownMenu.Item>

									<DropdownMenu.Item class={itemClass} onSelect={() => fitToView?.()}>
										<Frame class="h-4 w-4" />
										{t.fitToView}
									</DropdownMenu.Item>

									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger class="{itemClass} data-[state=open]:bg-muted">
											<Box class="h-4 w-4" />
											<span class="flex-1">{t.views}</span>
											<ChevronRight class="h-4 w-4 text-muted-foreground" />
										</DropdownMenu.SubTrigger>
										<DropdownMenu.SubContent
											sideOffset={4}
											class="min-w-32 p-1 shadow-md z-10001 rounded-md border bg-popover text-popover-foreground"
										>
											{#each VIEW_PRESETS as { preset, label } (preset)}
												<DropdownMenu.Item
													class="px-2 py-1.5 text-sm flex cursor-pointer items-center rounded-sm transition-colors outline-none select-none hover:bg-muted focus:bg-muted"
													onSelect={() => setView(preset)}
												>
													{label()}
												</DropdownMenu.Item>
											{/each}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>

									{#if config.showDisplayMenu}
										<DropdownMenu.Sub>
											<DropdownMenu.SubTrigger class="{itemClass} data-[state=open]:bg-muted">
												<Palette class="h-4 w-4" />
												<span class="flex-1">{t.display}</span>
												<ChevronRight class="h-4 w-4 text-muted-foreground" />
											</DropdownMenu.SubTrigger>
											<DropdownMenu.SubContent
												sideOffset={4}
												class="min-w-40 p-1 shadow-md z-10001 rounded-md border bg-popover text-popover-foreground"
											>
												{#each STYLE_OPTIONS as { look, label } (look)}
													<DropdownMenu.Item
														closeOnSelect={false}
														class="{itemClass} {renderStyle === look ? 'text-primary' : ''}"
														onSelect={() => setRenderStyle(look)}
													>
														<span class="flex-1">{label}</span>
														{#if renderStyle === look}
															<Check class="h-4 w-4" />
														{/if}
													</DropdownMenu.Item>
												{/each}

												<DropdownMenu.Separator class="my-1 h-px bg-border" />

												<DropdownMenu.Item
													closeOnSelect={false}
													class="{itemClass} {edgesVisible ? 'text-primary' : ''}"
													onSelect={toggleEdges}
												>
													<Spline class="h-4 w-4" />
													<span class="flex-1">{t.edges}</span>
													{#if edgesVisible}
														<Check class="h-4 w-4" />
													{/if}
												</DropdownMenu.Item>
											</DropdownMenu.SubContent>
										</DropdownMenu.Sub>
									{/if}

									<DropdownMenu.Item
										closeOnSelect={false}
										class="{itemClass} {measureActive ? 'text-primary' : ''}"
										onSelect={toggleMeasure}
									>
										<Ruler class="h-4 w-4" />
										<span class="flex-1">{t.measure}</span>
										{#if measureActive}
											<Check class="h-4 w-4" />
										{/if}
									</DropdownMenu.Item>

									{#if config.showGridToggle}
										<DropdownMenu.Item
											closeOnSelect={false}
											class="{itemClass} {gridVisible ? 'text-primary' : ''}"
											onSelect={toggleGrid}
										>
											<Grid3x3 class="h-4 w-4" />
											<span class="flex-1">{t.grid}</span>
											{#if gridVisible}
												<Check class="h-4 w-4" />
											{/if}
										</DropdownMenu.Item>
									{/if}

									{#if config.showSceneManager || config.showScreenshotButton || config.showFullscreenButton}
										<DropdownMenu.Separator class="my-1 h-px bg-border" />
									{/if}

									{#if config.showSceneManager}
										<DropdownMenu.Item
											closeOnSelect={false}
											class="{itemClass} {sceneManagerOpen ? 'text-primary' : ''}"
											onSelect={() => (sceneManagerOpen = !sceneManagerOpen)}
										>
											<Layers class="h-4 w-4" />
											<span class="flex-1">{t.sceneManager}</span>
											{#if sceneManagerOpen}
												<Check class="h-4 w-4" />
											{/if}
										</DropdownMenu.Item>
									{/if}

									{#if config.showScreenshotButton}
										<DropdownMenu.Item class={itemClass} onSelect={downloadScreenshot}>
											<Camera class="h-4 w-4" />
											{t.screenshot}
										</DropdownMenu.Item>
									{/if}

									{#if config.showFullscreenButton}
										<DropdownMenu.Item class={itemClass} onSelect={toggleFullscreen}>
											{#if isFullscreen}
												<Minimize class="h-4 w-4" />
												{t.exitFullscreen}
											{:else}
												<Maximize class="h-4 w-4" />
												{t.fullscreen}
											{/if}
										</DropdownMenu.Item>
									{/if}
								</DropdownMenu.Content>
							</DropdownMenu.Portal>
						</DropdownMenu.Root>
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

<MeshMetadataDialog
	open={selectedMeshMetadata !== null}
	metadata={selectedMeshMetadata}
	meshName={selectedMeshName}
	{isFullscreen}
	onOpenChange={(open: boolean) => {
		if (!open) {
			setTimeout(() => {
				selectedMeshMetadata = null;
				selectedMeshName = null;
			}, 200);
		}
	}}
/>

<style>
	.fullscreen-viewer {
		position: fixed;
		inset: 0;
		z-index: 10000;
		border-radius: 0 !important;
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

	@keyframes selva-viewer-fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}
</style>
