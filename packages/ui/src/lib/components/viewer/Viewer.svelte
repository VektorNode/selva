<script lang="ts">
	import { APP_DEFAULTS } from '../../constants';
	import { onMount, untrack } from 'svelte';
	import {
		initThree,
		updateScene,
		type ThreeInitializerOptions,
		type CameraController,
		type CameraProjection,
		type MeasureTool,
		type ViewPreset,
		type Grid
	} from '@selvajs/compute/visualization';
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
		ChevronRight
	} from '@lucide/svelte';
	import { DropdownMenu } from 'bits-ui';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import SceneManager from './SceneManager.svelte';
	import MeshMetadataDialog from './MeshMetadataDialog.svelte';
	import * as Resizable from '$lib/components/primitives/resizable/index.js';

	export interface ViewerConfig {
		showScreenshotButton?: boolean;
		showFullscreenButton?: boolean;
		showSceneManager?: boolean;
		showToolsMenu?: boolean;
		/** Expose the grid show/hide toggle in the tools menu. Grid starts hidden. */
		showGridToggle?: boolean;
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
	}

	const defaultViewerConfig: Required<ViewerConfig> = {
		showScreenshotButton: true,
		showFullscreenButton: true,
		showSceneManager: true,
		showToolsMenu: true,
		showGridToggle: true,
		enableMeshClick: true,
		backgroundColor: '#E6E6E6'
	};

	let {
		meshes,
		isFullscreen = $bindable(false),
		isSolving = false,
		isBlurred = false,
		drawerOpen = false,
		viewerConfig = {}
	}: Props = $props();

	const config = $derived({ ...defaultViewerConfig, ...viewerConfig });

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene | null = $state(null);
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let cameraController: CameraController | null = null;
	let measureTool: MeasureTool | null = null;
	let grid: Grid | null = null;
	let fitToView: (() => void) | null = null;
	let viewerInitialized = false;
	let sceneVersion = $state(0);
	let hideButton = $state(false);
	let sceneManagerOpen = $state(false);
	let projection: CameraProjection = $state('perspective');
	let measureActive = $state(false);
	let gridVisible = $state(false);
	let selectedMeshMetadata: Record<string, any> | null = $state(null);
	let selectedMeshName: string | null = $state(null);

	const VIEW_PRESETS: { preset: ViewPreset; label: string }[] = [
		{ preset: 'top', label: 'Top' },
		{ preset: 'front', label: 'Front' },
		{ preset: 'right', label: 'Right' },
		{ preset: 'back', label: 'Back' },
		{ preset: 'left', label: 'Left' },
		{ preset: 'bottom', label: 'Bottom' },
		{ preset: 'iso', label: 'Isometric' }
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

		const opts: ThreeInitializerOptions = {
			environment: { backgroundColor: config.backgroundColor },
			controls: {},
			// Build the grid so it can be toggled at runtime, but start hidden (off by default).
			grid: { enabled: config.showToolsMenu && config.showGridToggle },
			gizmo: { enabled: false },
			measure: { enabled: config.showToolsMenu },
			events: {
				onMeshMetadataClicked: config.enableMeshClick
					? (metadata: Record<string, string>) => {
							if (hasUsefulMetadata(metadata)) {
								selectedMeshMetadata = metadata;
								selectedMeshName = metadata?.name || 'Object';
							}
						}
					: undefined
			}
		};

		const init = initThree(canvas, opts);
		scene = init.scene;
		camera = init.camera;
		controls = init.controls;
		cameraController = init.cameraController;
		measureTool = init.measureTool;
		grid = init.grid;
		grid?.setVisible(gridVisible);
		fitToView = init.fitToView;
		projection = init.cameraController.getProjection();

		return () => {
			init.dispose();
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
	}

	$effect(() => {
		if (scene && camera && controls) {
			updateScene(scene, meshes, camera, controls, viewerInitialized);
			untrack(() => sceneVersion++);

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
								title="Viewer tools"
								aria-label="Viewer tools"
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
											Switch to 2D
										{:else}
											<Box class="h-4 w-4" />
											Switch to 3D
										{/if}
									</DropdownMenu.Item>

									<DropdownMenu.Item class={itemClass} onSelect={() => fitToView?.()}>
										<Frame class="h-4 w-4" />
										Fit to view
									</DropdownMenu.Item>

									<DropdownMenu.Sub>
										<DropdownMenu.SubTrigger class="{itemClass} data-[state=open]:bg-muted">
											<Box class="h-4 w-4" />
											<span class="flex-1">Views</span>
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
													{label}
												</DropdownMenu.Item>
											{/each}
										</DropdownMenu.SubContent>
									</DropdownMenu.Sub>

									<DropdownMenu.Item
										closeOnSelect={false}
										class="{itemClass} {measureActive ? 'text-primary' : ''}"
										onSelect={toggleMeasure}
									>
										<Ruler class="h-4 w-4" />
										<span class="flex-1">Measure</span>
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
											<span class="flex-1">Grid</span>
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
											<span class="flex-1">Scene manager</span>
											{#if sceneManagerOpen}
												<Check class="h-4 w-4" />
											{/if}
										</DropdownMenu.Item>
									{/if}

									{#if config.showScreenshotButton}
										<DropdownMenu.Item class={itemClass} onSelect={downloadScreenshot}>
											<Camera class="h-4 w-4" />
											Screenshot
										</DropdownMenu.Item>
									{/if}

									{#if config.showFullscreenButton}
										<DropdownMenu.Item class={itemClass} onSelect={toggleFullscreen}>
											{#if isFullscreen}
												<Minimize class="h-4 w-4" />
												Exit fullscreen
											{:else}
												<Maximize class="h-4 w-4" />
												Fullscreen
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
		{#if sceneManagerOpen && scene}
			<Resizable.Handle withHandle />
			<Resizable.Pane defaultSize={15} minSize={8} maxSize={30}>
				<SceneManager {scene} {sceneVersion} />
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
