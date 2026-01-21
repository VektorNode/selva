<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import {
		TabLayout,
		PageContainer,
		PageHeader,
		StateDisplay,
		Button,
		StateManager,
		getDefaultValue,
		type UISchema,
		Viewer,
		createSolvingIndicator,
		SolvingIndicator,
		ComputeMessages
	} from '@selva/shared';
	import { hexToOklch } from '$lib/utilities/color';
	import { GrasshopperResponseProcessor } from 'selva-compute';

	let { data }: PageProps = $props();

	let schema = $derived(data.schema);
	let ghDefinition = $derived(data.ghDefinition);

	// Definition switcher
	let currentDefinition = $derived(data.currentDefinition);
	let availableDefinitions = $derived(data.availableDefinitions);
	let currentDefinitionMetadata = $derived(
		availableDefinitions.find((d) => d.filename === currentDefinition)
	);
	let pageTitle = $derived(schema?.description || schema.name);

	function createInitialValues(s: UISchema | undefined) {
		if (!s) return {};
		const v: Record<string, unknown> = {};

		for (const input of s.inputs) {
			v[input.id] = input.default ?? getDefaultValue(input.paramType);
		}
		for (const output of s.outputs) {
			v[output.id] = null;
		}
		return v;
	}

	// Core state
	// values is initialized once per component instance.
	// The {#key} block in markup ensures re-creation when definition changes.
	let values = $state<Record<string, unknown>>(createInitialValues(data.schema));
	let solving = $state(false);
	let error = $state('');
	let computeErrors = $state<string[]>([]);
	let computeWarnings = $state<string[]>([]);

	// UI state for debouncing the "Solving..." indicator
	const solvingIndicator = createSolvingIndicator(() => solving);

	// Viewer state
	let meshes = $state<any[]>([]);

	// Manual solve mode
	let pendingValues = $state<Record<string, unknown>>({});
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);

	// Reset state when definition changes and trigger initial solve
	$effect(() => {
		const _ = currentDefinition;

		untrack(() => {
			meshes = [];
			values = createInitialValues(schema);
			error = '';
			computeErrors = [];
			computeWarnings = [];
			solving = false;

			if (schema && Object.keys(values).length > 0) {
				performSolve();
			}
		});
	});

	// Check if viewer should be shown (either enableLocal or enableRemote)
	const shouldShowViewer = $derived(
		schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote
	);

	// -----------------------------
	// Solve logic
	// -----------------------------
	async function performSolve() {
		try {
			solving = true;
			error = '';
			computeErrors = [];
			computeWarnings = [];

			const payload = {
				inputs: schema.inputs,
				values: $state.snapshot(values),
				definitionUrl: ghDefinition // Use server-provided URL
			};

			const res = await fetch('/api/compute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!res.ok) {
				const d = await res.json();
				throw new Error(d.message || 'Compute error');
			}

			const solved = await res.json();

			console.log('Solve result:', solved);

			// Extract errors and warnings from the solve result
			if (solved.errors && Array.isArray(solved.errors)) {
				computeErrors = solved.errors;
			}
			if (solved.warnings && Array.isArray(solved.warnings)) {
				computeWarnings = solved.warnings;
			}

			const processor = new GrasshopperResponseProcessor(solved, false);

			if (shouldShowViewer) {
				meshes = await processor.extractMeshesFromResponse();
			}

			const outputs: Record<string, unknown> = {};
			for (const o of schema.outputs) {
				outputs[o.id] = processor.getValueByParamId(o.id, { parseValues: true });
			}

			values = { ...values, ...outputs };
			pendingValues = {};
			hasPendingChanges = false;
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			solving = false;
		}
	}

	// -----------------------------
	// Handlers
	// -----------------------------
	async function handleValueChange(id: string, val: unknown) {
		values[id] = val;

		if (schema?.instanceSolve === false) {
			pendingValues[id] = val;
			hasPendingChanges = true;
			return;
		}

		await performSolve();
	}

	function handleCalculate() {
		if (hasPendingChanges) performSolve();
	}

	const BADGES = {
		solving: { label: 'Solving...', variant: 'solving' } as const,
		compute: { label: 'Rhino Compute', variant: 'compute' } as const
	};

	const badgeConfig = $derived(solvingIndicator.show ? BADGES.solving : BADGES.compute);

	let isEmbedded = $derived(page.url.searchParams.get('embed') === 'true');
	let customStyle = $derived.by(() => {
		const p = page.url.searchParams;
		const styles: string[] = [];
		const primary = p.get('primary');

		if (primary) styles.push(`--primary: ${hexToOklch(primary)}`);

		return styles.join('; ');
	});
</script>

<div style={customStyle} style:display="contents">
	<PageContainer>
		{#if !isEmbedded}
			<PageHeader title={pageTitle} badge={badgeConfig} showModeToggle={true} />
		{/if}

		<div class="bg-background flex-1 overflow-hidden">
			{#if error}
				<div class="flex min-h-100 items-center justify-center p-8">
					<StateDisplay type="error" size="medium" message={error} />
				</div>
			{:else if !schema}
				<div class="flex min-h-100 items-center justify-center">
					<StateDisplay type="loading" size="large" message="Loading schema..." />
				</div>
			{:else}
				<div style:display="contents">
					{#key currentDefinition}
						<div
							class="flex h-full flex-col gap-6 overflow-hidden p-6 lg:flex-row {isViewerFullscreen
								? 'fullscreen-container'
								: ''}"
						>
							<!-- Controls -->
							<div
								class="w-full shrink-0 overflow-y-auto lg:w-120 xl:w-130 {isViewerFullscreen
									? 'hidden'
									: ''}"
							>
								{#if schema.layout.type === 'tabbed'}
									<TabLayout
										{schema}
										bind:values
										onValueChange={handleValueChange}
										debounceSliders={false}
										environment="compute"
									/>
								{/if}

								<!-- State Manager -->
								<div class="mt-6">
									<StateManager
										{schema}
										currentValues={values}
										onLoadValues={async (loadedValues) => {
											// Apply loaded values
											values = { ...values, ...loadedValues };

											// Trigger solve based on instanceSolve setting
											if (schema?.instanceSolve !== false) {
												await performSolve();
											} else {
												hasPendingChanges = true;
											}
										}}
									/>
								</div>

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
												<div
													class="border-background mr-2 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
												></div>
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

							<!-- Viewer -->
							{#if shouldShowViewer}
								<Viewer {schema} {meshes} bind:isFullscreen={isViewerFullscreen} />
							{/if}
						</div>
					{/key}

					<SolvingIndicator show={solvingIndicator.show && schema.instanceSolve !== false} />
				</div>
			{/if}
		</div>

		<!-- Floating Compute Messages -->
		<ComputeMessages errors={computeErrors} warnings={computeWarnings} />
	</PageContainer>
</div>

<style>
	.fullscreen-container {
		position: fixed;
		inset: 0;
		z-index: 9999;
		padding: 0 !important;
		background: white;
	}
</style>
