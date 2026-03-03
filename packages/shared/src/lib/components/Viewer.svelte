<script lang="ts">
	import { onMount } from 'svelte';
	import { initThree, updateScene } from 'selva-compute/visualization';
	import type { UISchema } from '../types/generated';
	import { Maximize, Minimize, Camera } from '@lucide/svelte';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let viewerInitialized = false;
	let hideButton = $state(false);

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
	class="min-h-64 sm:min-h-96 lg:min-h-125 shadow-lg relative h-full flex-1 {isFullscreen
		? 'fullscreen-viewer'
		: ''}"
>
	<div class="inset-0 absolute">
		<canvas
			class="block h-full w-full"
			style={isFullscreen ? '' : 'border-radius: 0.625rem;'}
			bind:this={canvas}
		></canvas>
	</div>

	<!-- Drawer open blur overlay -->
	<div
		class="inset-0 blur-overlay sm:border absolute z-20 rounded-lg border-border {isBlurred
			? 'blur-overlay-active'
			: 'blur-overlay-inactive'}"
	></div>

	<!-- Solving overlay: blurs the canvas -->
	{#if isSolving}
		<div
			class="inset-0 absolute z-10 animate-[selva-viewer-fade-in_0.2s_ease-out] rounded-lg backdrop-blur-[2px] transition-all duration-300"
		></div>
	{/if}

	<!-- Viewer Control Buttons (hidden when drawer is open on mobile) -->
	<div
		class="right-4 {isFullscreen
			? 'bottom-4'
			: 'bottom-16 sm:bottom-4'} gap-2 absolute z-50 flex items-center"
		style={hideButton ? 'opacity: 0; pointer-events: none;' : 'opacity: 1; pointer-events: auto;'}
	>
		<!-- Screenshot Button -->
		<button
			class="h-10 w-10 bg-white/90 shadow-lg hover:bg-white hover:shadow-xl flex items-center justify-center rounded-lg border border-border transition-all active:scale-95"
			onclick={downloadScreenshot}
			title="Download screenshot"
			aria-label="Download screenshot"
		>
			<Camera class="h-5 w-5 text-gray-700" />
		</button>

		<!-- Fullscreen Toggle Button -->
		<button
			class="h-10 w-10 bg-white/90 shadow-lg hover:bg-white hover:shadow-xl flex items-center justify-center rounded-lg border border-border transition-all active:scale-95"
			onclick={toggleFullscreen}
			title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
		>
			{#if isFullscreen}
				<Minimize class="h-5 w-5 text-gray-700" />
			{:else}
				<Maximize class="h-5 w-5 text-gray-700" />
			{/if}
		</button>
	</div>
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
