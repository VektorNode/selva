<script lang="ts">
	import { onMount } from 'svelte';
	import { initThree, updateScene } from 'selva-compute/visualization';
	import type { UISchema } from '../types/generated';
	import { Maximize, Minimize, Camera, Layers } from '@lucide/svelte';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
	import SceneManager from './viewer/SceneManager.svelte';
	import * as Resizable from '$lib/components/ui/resizable/index.js';

	interface Props {
		schema: UISchema;
		meshes: any[];
		isFullscreen?: boolean;
		isSolving?: boolean;
		isBlurred?: boolean;
		drawerOpen?: boolean;
	}

	let {
		schema,
		meshes,
		isFullscreen = $bindable(false),
		isSolving = false,
		isBlurred = false,
		drawerOpen = false
	}: Props = $props();

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene | null = $state(null);
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let viewerInitialized = false;
	let hideButton = $state(false);
	let sceneManagerOpen = $state(false);

	// Hide button instantly when expanding, show after animation when collapsing
	$effect(() => {
		if (drawerOpen) {
			hideButton = true;
		} else {
			const timer = setTimeout(() => {
				hideButton = false;
			}, 350);
			return () => clearTimeout(timer);
		}
	});

	// Initialize Three.js
	onMount(() => {
		if (!canvas) return;

		const opts = {
			environment: { backgroundColor: schema?.viewerOptions?.backgroundColor ?? '#E6E6E6' }
		};

		const init = initThree(canvas, opts);
		scene = init.scene;
		camera = init.camera;
		controls = init.controls;
	});

	// React to meshes changes
	// We need to manually handle cleanup of Lines and Points because selva-compute's updateScene
	// might only clean up Meshes.
	$effect(() => {
		if (scene && camera && controls) {
			// Manual cleanup of types that updateScene might miss (Lines, Points)

			updateScene(scene, meshes, camera, controls, viewerInitialized);

			if (!viewerInitialized && meshes.length > 0) {
				viewerInitialized = true;
			}
		}
	});

	function toggleFullscreen() {
		isFullscreen = !isFullscreen;
	}

	function downloadScreenshot() {
		if (!canvas) return;

		// Use requestAnimationFrame to ensure a render has completed
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
		<!-- Canvas Pane -->
		<Resizable.Pane defaultSize={100} minSize={40}>
			<div class="relative h-full w-full" style="touch-action: none;">
				<canvas class="block h-full w-full" bind:this={canvas}></canvas>

				<!-- Drawer open blur overlay -->
				<div
					class="inset-0 blur-overlay absolute z-20 {isBlurred
						? 'blur-overlay-active'
						: 'blur-overlay-inactive'}"
				></div>

				<!-- Solving overlay -->
				{#if isSolving}
					<div
						class="inset-0 absolute z-10 animate-[selva-viewer-fade-in_0.2s_ease-out] backdrop-blur-[2px] transition-all duration-300"
					></div>
				{/if}

				<!-- Viewer Control Buttons -->
				<div
					class="right-4 {isFullscreen
						? 'bottom-4'
						: 'bottom-16 sm:bottom-4'} gap-2 absolute z-50 flex items-center"
					style={hideButton
						? 'opacity: 0; pointer-events: none;'
						: 'opacity: 1; pointer-events: auto;'}
				>
					<!-- Screenshot Button -->
					<button
						class="h-10 w-10 shadow-lg hover:shadow-xl flex items-center justify-center rounded-lg border border-border bg-card/90 transition-all hover:bg-card active:scale-95"
						onclick={downloadScreenshot}
						title="Download screenshot"
						aria-label="Download screenshot"
					>
						<Camera class="h-5 w-5 text-card-foreground" />
					</button>

					<!-- Fullscreen Toggle -->
					<button
						class="h-10 w-10 shadow-lg hover:shadow-xl flex items-center justify-center rounded-lg border border-border bg-card/90 transition-all hover:bg-card active:scale-95"
						onclick={toggleFullscreen}
						title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
						aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
					>
						{#if isFullscreen}
							<Minimize class="h-5 w-5 text-card-foreground" />
						{:else}
							<Maximize class="h-5 w-5 text-card-foreground" />
						{/if}
					</button>

					<!-- Scene Manager Toggle -->
					<button
						class="h-10 w-10 shadow-lg hover:shadow-xl flex items-center justify-center rounded-lg border transition-all active:scale-95 {sceneManagerOpen
							? 'border-primary bg-primary/10 hover:bg-primary/20'
							: 'border-border bg-card/90 hover:bg-card'}"
						onclick={() => (sceneManagerOpen = !sceneManagerOpen)}
						title={sceneManagerOpen ? 'Hide scene manager' : 'Show scene manager'}
						aria-label="Toggle scene manager"
					>
						<Layers class="h-5 w-5 {sceneManagerOpen ? 'text-primary' : 'text-card-foreground'}" />
					</button>
				</div>
			</div>
		</Resizable.Pane>

		<!-- Scene Manager Pane -->
		{#if sceneManagerOpen && scene}
			<Resizable.Handle withHandle />
			<Resizable.Pane defaultSize={25} minSize={15} maxSize={50}>
				<SceneManager {scene} />
			</Resizable.Pane>
		{/if}
	</Resizable.PaneGroup>
</div>

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
