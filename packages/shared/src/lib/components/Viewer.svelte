<script lang="ts">
	import { onMount } from 'svelte';
	import { initThree, updateScene } from 'selva-compute/visualization';
	import type { UISchema } from '../types/generated';
	import { Maximize, Minimize } from '@lucide/svelte';
	import type * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

	interface Props {
		schema: UISchema;
		meshes: any[];
		isFullscreen?: boolean;
		isSolving?: boolean;
	}

	let { schema, meshes, isFullscreen = $bindable(false), isSolving = false }: Props = $props();

	let canvas: HTMLCanvasElement;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let viewerInitialized = false;

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
</script>

<div
	class="min-h-125 bg-white shadow-lg relative h-full flex-1 rounded-lg {isFullscreen
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

	<!-- Solving overlay: blurs the canvas and shows a subtle indicator -->
	{#if isSolving}
		<div
			class="inset-0 absolute z-10 animate-[selva-viewer-fade-in_0.2s_ease-out] rounded-lg backdrop-blur-[2px] transition-all duration-300"
		>
			<div
				class="right-3 top-3 gap-2 bg-black/40 px-2.5 py-1.5 text-white backdrop-blur-sm absolute flex items-center rounded-md"
			>
				<div
					class="h-2.5 w-2.5 animate-spin border-white rounded-full border-2 border-t-transparent"
				></div>
				<span class="text-xs font-medium tracking-wide">Updating</span>
			</div>
		</div>
	{/if}

	<!-- Fullscreen Toggle Button -->
	<button
		class="right-4 bottom-4 h-10 w-10 bg-white/90 shadow-lg hover:bg-white hover:shadow-xl absolute z-50 flex items-center justify-center rounded-lg transition-all active:scale-95"
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

<style>
	.fullscreen-viewer {
		position: fixed;
		inset: 0;
		z-index: 10000;
		border-radius: 0 !important;
		min-height: 100vh;
		width: 100vw;
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
