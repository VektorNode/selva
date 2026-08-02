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
		type Grid
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
		/** Expose the grid show/hide toggle in the tools menu. Grid starts hidden. */
		showGridToggle?: boolean;
		/**
		 * Expose the "Display" submenu (render style picker + edges toggle) in the tools menu.
		 * Defaults on. Starts on the 'technical' style with edges shown.
		 */
		showDisplayMenu?: boolean;
		enableMeshClick?: boolean;
		backgroundColor?: string;
	}

	interface Props {
		meshes: any[];
		isFullscreen?: boolean;
		isSolving?: boolean;
		isBlurred?: boolean;
		drawerOpen?: boolean;
		viewerConfig?: ViewerConfig;
		/**
		 * Branding logo URL. When set, shown as a small watermark in the viewer's
		 * bottom-right corner. Omitted/empty renders nothing.
		 */
		logoUrl?: string;
		/**
		 * UI language for the viewer's own chrome (tools menu, panels, dialogs).
		 * When set, the viewer provides it to its subtree. When omitted, the viewer
		 * reads the nearest locale context (set by the host app), defaulting to
		 * English. Does not translate Grasshopper-sourced names/metadata.
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
		backgroundColor: '#E6E6E6'
	};

	let {
		meshes,
		isFullscreen = $bindable(false),
		isSolving = false,
		isBlurred = false,
		drawerOpen = false,
		viewerConfig = {},
		logoUrl,
		lang
	}: Props = $props();

	const config = $derived({ ...defaultViewerConfig, ...viewerConfig });

	// Read any host-provided locale before we (maybe) override it for our subtree.
	const hostLocale = getLocaleContext();

	// Resolution order: explicit `lang` prop → host locale context → default.
	// Provide the resolved value to our subtree so the scene manager and metadata
	// dialog read the same locale. The getter is re-read reactively, so switching
	// the `lang` prop (or the host's locale) updates the chrome live.
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
	let setLook: ((look: Look) => void) | null = null;
	let updateGridScale: (() => void) | null = null;
	let fitToView: (() => void) | null = null;
	let viewerInitialized = false;
	let sceneVersion = $state(0);
	let hideButton = $state(false);
	let sceneManagerOpen = $state(false);

	// The scene outliner lives here rather than inside <SceneManager> because that component is
	// mounted only while its panel is open. Hidden objects must stay hidden when the panel is
	// closed — and must be re-hidden after each solve, which nothing would do if the state
	// unmounted with the panel.
	const hiddenObjects = new SvelteSet<string>();
	const selectedObjects = new SvelteSet<string>();
	const collapsedLayers = new SvelteSet<string>();
	let outliner: SceneOutliner | null = $state(null);
	let projection: CameraProjection = $state('perspective');
	let measureActive = $state(false);
	let gridVisible = $state(false);
	// Render style + edge overlays. 'technical' is the default look; edges (crease lines) start on so
	// the technical look reads as a CAD shaded view — both are user-switchable via the Display submenu.
	let renderStyle: Look = $state('technical');
	let edgesVisible = $state(true);
	let selectedMeshMetadata: Record<string, any> | null = $state(null);
	let selectedMeshName: string | null = $state(null);

	// Render-style options for the Display submenu, derived from the library's LOOKS array — adding or
	// renaming a look in @selvajs/compute updates this automatically. Label is the value capitalized.
	const STYLE_OPTIONS: { look: Look; label: string }[] = LOOKS.map((look) => ({
		look,
		label: look.charAt(0).toUpperCase() + look.slice(1)
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

		// Only options that differ from the library defaults. Seed the initial render style (also the
		// library default, but stated explicitly since it's user-switchable via the Display menu) and
		// switch off the sun/shadows the technical look doesn't need — flat ambient + HDR image-based
		// lighting (baseHDR loads by default) carry it. Grid/measure/click are the tools this viewer uses.
		const opts: ThreeInitializerOptions = {
			look: renderStyle,
			lighting: { enableSunlight: false },
			render: { enableShadows: false },
			environment: { backgroundColor: config.backgroundColor },
			// Build the grid so it can be toggled at runtime, but start hidden (off by default).
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
		setLook = init.setLook;
		updateGridScale = init.updateGridScale;
		fitToView = init.fitToView;
		projection = init.cameraController.getProjection();

		const renderer = init.renderer;

		return () => {
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

	// Add/remove crease-edge overlays on the current scene content. applyEdges is idempotent per mesh
	// (and attaches large meshes' overlays async, off the main thread); clearEdges is its inverse —
	// it also cancels in-flight attaches and stands down the screen-space fallback for capped meshes.
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
			// updateScene clears and re-adds all content each solve, so the previous solve's edge
			// overlays are gone — re-attach them if edges are currently shown. Read the flag untracked:
			// toggling edges is handled directly by toggleEdges(), so it must not re-trigger a full solve.
			untrack(() => {
				if (edgesVisible) applyEdges?.(scene!);
				// Rescale the grid to the new content's extent so cells and fade match the part size.
				updateGridScale?.();
				// The rebuild above also un-hid everything the user had hidden. Re-hide it: the outliner
				// keys that state on Grasshopper identity, not on the instances just discarded.
				outliner?.applyTo();
				sceneVersion++;
				// New solve content — repaint now rather than on the render loop's safety interval.
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
			'originalIndex',
			'sourceComponentId',
			'vertexCount',
			'faceCount',
			'vertexOffset',
			'faceOffset'
		]);
		const usefulEntries = Object.entries(metadata).filter(([key]) => !EXCLUDED_KEYS.has(key));
		return usefulEntries.length > 0;
	}

	function downloadScreenshot() {
		if (!canvas) return;

		requestAnimationFrame(() => {
			canvas.toBlob((blob) => {
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
			});
		});
	}
</script>

<div
	class="min-h-64 sm:min-h-96 lg:min-h-125 relative h-full flex-1 border {isFullscreen
		? 'fullscreen-viewer'
		: 'overflow-hidden rounded-[0.625rem]'}"
>
	<Resizable.PaneGroup direction="horizontal" class="h-full w-full">
		<Resizable.Pane defaultSize={100} minSize={40}>
			<div class="relative h-full w-full" style="touch-action: none;">
				<canvas class="block h-full w-full" bind:this={canvas}></canvas>

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
					<!-- Branding watermark, bottom-right. Matches the tools menu's
					     bottom offset so it clears the mobile drawer handle, and is
					     non-interactive so it never intercepts canvas drags. -->
					<div
						class="right-4 {isFullscreen ? 'bottom-4' : 'bottom-16 sm:bottom-4'} absolute z-20"
						style={hideButton
							? 'opacity: 0; pointer-events: none;'
							: 'opacity: 1; pointer-events: none;'}
					>
						<img
							src={logoUrl}
							alt=""
							class="h-8 max-w-32 drop-shadow-sm sm:h-10 w-auto object-contain opacity-80"
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
									<!-- Camera -->
									<DropdownMenu.Item class={itemClass} onSelect={toggleProjection}>
										{#if projection === 'perspective'}
											<Square class="h-4 w-4" />
											{t.switchTo2D}
										{:else}
											<Box class="h-4 w-4" />
											{t.switchTo3D}
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
												<!-- Render style: single-choice, current one checked. -->
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

												<!-- Edges overlay toggle. -->
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

									<!-- Scene tools -->
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

		<!-- Scene Manager Pane -->
		{#if sceneManagerOpen && scene && outliner}
			<Resizable.Handle withHandle />
			<Resizable.Pane defaultSize={15} minSize={8} maxSize={30}>
				<SceneManager {outliner} {sceneVersion} />
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

	/* Blur overlay animation */
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
