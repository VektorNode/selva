<script lang="ts">
	import type { PageProps } from './$types';
	import { TabLayout } from '$lib/components/preview';
	import { PageContainer, PageHeader } from '$lib/components/layout';
	import { StateDisplay, Button } from '$lib/components/ui';
	import { initThree, updateScene, GrasshopperResponseProcessor } from 'rhino-compute-core';
	import * as THREE from 'three';
	import { type OrbitControls } from 'three/examples/jsm/Addons.js';
	import { onMount } from 'svelte';
	import type { ThreeInitializerOptions } from 'rhino-compute-core/visualization';
	import { getDefaultValue } from '$lib/utils/session';

	let { data }: PageProps = $props();

	let schema = $state(data.schema);

	let values: Record<string, unknown> = $state({});
	let solving = $state(false);
	let error = $state('');
	let canvas: HTMLCanvasElement | null = $state(null);
	let scene: THREE.Scene | null = $state(null);
	let camera: THREE.PerspectiveCamera;
	let controls: OrbitControls;
	let viewerInitialized = $state(false);

	// Manual solve mode: track pending changes
	let pendingValues = $state<Record<string, unknown>>({});
	let hasPendingChanges = $state(false);

	$effect(() => {
		if (schema) {
			const initialValues: Record<string, unknown> = {};

			schema.inputs.forEach((input) => {
				console.log('Setting initial value for input:', input.name, input.default, input.id);
				initialValues[input.id] = input.default ?? getDefaultValue(input.paramType);
			});

			schema.outputs.forEach((output) => {
				initialValues[output.id] = null;
			});

			values = initialValues;
		}
	});

	async function handleValueChange(parameterId: string, value: unknown) {
		values[parameterId] = value;

		// If instanceSolve is false, track pending changes instead of solving immediately
		if (schema?.instanceSolve === false) {
			pendingValues[parameterId] = value;
			hasPendingChanges = true;
			console.log('[App] Manual solve mode: value queued for next calculation');
			return;
		}

		// Instance solve mode: solve immediately
		await performSolve();
	}

	async function performSolve() {
		try {
			solving = true;
			error = '';

			const response = await fetch('/api/compute', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					inputs: schema.inputs,
					values: $state.snapshot(values),
					definitionUrl: 'http://localhost:5173/builder_test.gh',
					serverUrl: 'http://localhost:5000/'
				})
			});

			if (!response.ok) {
				const errorData = await response.json();
				throw new Error(errorData.message || 'Failed to solve definition');
			}

			const solvedDefinition = await response.json();

			// Process the response on client side (mesh extraction requires Three.js)
			const processor = new GrasshopperResponseProcessor(solvedDefinition);
			const outputValues = processor.getValues();

			// Update 3D viewer if enabled
			if (schema.enable3dViewer && scene) {
				const meshes = processor.extractMeshesFromResponse();
				updateScene(scene, meshes, camera, controls, viewerInitialized);
				viewerInitialized = true;
			}

			// Map outputs by id (Grasshopper GUID)
			const mappedOutputs: Record<string, unknown> = {};

			Object.entries(outputValues.values).forEach(([computeKey, computeValue]) => {
				const matchingOutput = schema.outputs.find((output) => {
					if (output.id && computeKey === output.id) return true;
					if (computeKey === output.name) return true;
					if (computeKey === output.nickname) return true;
					return false;
				});

				if (matchingOutput) {
					mappedOutputs[matchingOutput.id] = computeValue;
				} else {
					mappedOutputs[computeKey] = computeValue;
				}
			});

			values = { ...values, ...mappedOutputs };

			// Clear pending changes after successful solve
			pendingValues = {};
			hasPendingChanges = false;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to solve definition';
			console.error('Solve error:', err);
		} finally {
			solving = false;
		}
	}

	/**
	 * Manual solve: send all pending changes to Rhino Compute
	 */
	function handleCalculate() {
		if (!hasPendingChanges) return;
		performSolve();
	}

	const badgeConfig = $derived(
		solving
			? { label: 'Solving...', variant: 'solving' as const }
			: { label: 'Rhino Compute', variant: 'compute' as const }
	);

	onMount(() => {
		if (schema.enable3dViewer && canvas && !viewerInitialized) {
			const option: ThreeInitializerOptions = {
				environment: { backgroundColor: '#4b5357' }
			};
			const threeSetup = initThree(canvas, option);
			scene = threeSetup.scene;
			camera = threeSetup.camera;
			controls = threeSetup.controls;
		}
	});
</script>

<PageContainer>
	<PageHeader title={schema.name} badge={badgeConfig} />

	<div class="flex-1 overflow-hidden bg-background">
		{#if error}
			<div class="flex min-h-[400px] items-center justify-center p-8">
				<StateDisplay type="error" size="medium" message={error} />
			</div>
		{:else if !schema}
			<div class="flex min-h-[400px] items-center justify-center">
				<StateDisplay type="loading" size="large" message="Loading schema..." />
			</div>
		{:else}
			<div class="flex h-full flex-col gap-6 overflow-hidden p-6 lg:flex-row">
				<div class="w-full shrink-0 overflow-y-auto lg:w-[480px] xl:w-[520px]">
					{#if schema.layout.type === 'tabbed' && schema.layout.tabs && schema.layout.tabs.length > 0}
						<TabLayout
							{schema}
							bind:values
							onValueChange={handleValueChange}
							debounceSliders={false}
						/>
				
					{/if}

					{#if schema.instanceSolve === false}
						<div class="sticky bottom-0 mt-6 flex justify-center">
							<Button
								variant={hasPendingChanges ? 'default' : 'outline'}
								size="lg"
								onclick={handleCalculate}
								disabled={!hasPendingChanges || solving}
								class="shadow-lg"
							>
								{#if solving}
									<div class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent"></div>
									Solving...
								{:else if hasPendingChanges}
									Calculate
								{:else}
									No Changes
								{/if}
							</Button>
						</div>
					{/if}
				</div>

				{#if schema.enable3dViewer}
					<div class="min-h-[500px] flex-1 overflow-hidden rounded-lg bg-white shadow-lg">
						<canvas class="block h-full w-full" bind:this={canvas}></canvas>
					</div>
				{/if}
			</div>
		{/if}
	</div>
</PageContainer>
