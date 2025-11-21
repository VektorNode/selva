<script lang="ts">
	// --- Imports ---
	import MessageOverlay from '$lib/components/MessageOverlay.svelte';
	import { type DataTree, type GrasshopperComputeResponse } from 'rhino-compute-core/grasshopper';
	import {
		getThreeMeshesFromComputeResponse,
		initThree,
		updateScene
	} from 'rhino-compute-core/visualization';
	import { onMount } from 'svelte';
	import * as THREE from 'three';
	import type { OrbitControls } from 'three/examples/jsm/Addons.js';
	import { InputHandler, LoadingScreen } from 'rhino-compute-ui';

	// --- Props from page loader ---
	let { data } = $props();

	// --- State ---
	let scene: THREE.Scene | null = $state(null);
	let canvas: HTMLCanvasElement | null = $state(null);
	let controls: OrbitControls;
	let camera: THREE.PerspectiveCamera;
	let isComputing = $state(false);
	let viewerInitialized = $state(false);

	// Simplified message state
	let messages = $state({
		error: null as string | null,
		warnings: [] as string[],
		computeErrors: [] as string[],
		show: true
	});

	// Check if there are inputs to display
	const hasInputs = $derived(
		data.ghInOutputs?.inputs &&
			Array.isArray(data.ghInOutputs.inputs) &&
			data.ghInOutputs.inputs.length > 0
	);

	// Utility function for error handling
	function handleApiError(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	async function handleCompute(tree: DataTree[]) {
		// Prevent multiple simultaneous requests
		if (isComputing) {
			console.log('[CLIENT] Computation already in progress, skipping...');
			return;
		}

		isComputing = true;

		// Reset messages before new request
		messages.error = null;
		messages.warnings = [];
		messages.computeErrors = [];

		// Give the browser a chance to render the loading screen
		await new Promise(resolve => setTimeout(resolve, 0));

		try {
			const response = await fetch('/api/compute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					tree,
					pointerName: data.pointerName
				})
			});

			if (!response.ok) {
				throw new Error(`API request failed: ${response.statusText}`);
			}

			const result = (await response.json()) as GrasshopperComputeResponse;

			// Handle Rhino Compute errors and warnings safely
			if (result) {
				messages.computeErrors = Array.isArray(result.errors) ? result.errors : [];
				messages.warnings = Array.isArray(result.warnings) ? result.warnings : [];
			}

			// Only update scene if result exists
			if (result && scene) {
				const meshes = await getThreeMeshesFromComputeResponse(result);

				if (!viewerInitialized) {
					// Initial setup
					updateScene(scene, meshes, camera, controls, false);
					viewerInitialized = true;
				} else {
					// Subsequent updates
					updateScene(scene, meshes, camera, controls, true);
				}
			}
		} catch (err) {
			messages.error = handleApiError(err);
		} finally {
			isComputing = false;
		}
	}

	// --- Three.js Scene Setup ---
	onMount(async () => {
		if (canvas) {
			const threeSetup = initThree(canvas);
			scene = threeSetup.scene;
			camera = threeSetup.camera;
			controls = threeSetup.controls;

			// If no inputs, trigger initial compute to show output
			if (!hasInputs) {
				await handleCompute([]);
			}
		}
	});
</script>

<svelte:head>
	<title>Rhino Compute Example</title>
</svelte:head>

<!-- Simplified Layout -->
<div class="flex h-screen w-screen">
	{#if hasInputs}
		<aside class="flex h-full w-80 flex-shrink-0 flex-col overflow-hidden border-r bg-gray-50 p-4">
			<InputHandler
				input={data.ghInOutputs.inputs}
				onChange={handleCompute}
				headerText="Grasshopper Inputs"
				autoUpdate={true}
				displayOptions={{ showSliders: false, showRangeIndicator: false, accordionSeparated: true }}
			/>

			{#if isComputing}
				<div class="mt-2 rounded bg-blue-50 p-2 text-center text-sm text-blue-700">
					Computing...
				</div>
			{/if}
		</aside>
	{/if}

	<LoadingScreen
		isVisible={isComputing}
		message="Computing your Grasshopper definition..."
		backdrop="blur"
		spinnerSize="large"
	/>

	<main class="relative h-full flex-1">
		<canvas class="pointer-events-auto block h-full w-full rounded-xl" bind:this={canvas}></canvas>

		<MessageOverlay
			errorMessage={messages.error}
			warnings={messages.warnings}
			computeErrors={messages.computeErrors}
			showMessages={messages.show}
			onShowMessagesToggle={(show) => (messages.show = show)}
			onDismissMessage={(type, index) => {
				if (type === 'error') messages.error = null;
				else if (type === 'warning' && index !== undefined) messages.warnings.splice(index, 1);
				else if (type === 'computeError' && index !== undefined)
					messages.computeErrors.splice(index, 1);
			}}
			onClearAllMessages={() => {
				messages.error = null;
				messages.warnings = [];
				messages.computeErrors = [];
			}}
		/>
	</main>
</div>
