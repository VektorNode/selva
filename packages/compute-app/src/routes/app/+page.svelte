<script lang="ts">
	import { untrack, onMount, onDestroy } from 'svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';
	import {
		PageContainer,
		PageHeader,
		StateDisplay,
		getDefaultValue,
		type UISchema,
		AppLayout,
		createSolvingIndicator,
		createComputeThrottle,
		useFooterItem
	} from '@selva/shared';
	import { hexToOklch } from '$lib/utilities/color';
	import { GrasshopperResponseProcessor } from 'selva-compute';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';
	import ComputeHealthFooter from '$lib/components/ComputeHealthFooter.svelte';

	let { data }: PageProps = $props();

	let schema = $derived(data.schema);
	let ghDefinition = $derived(data.ghDefinition);
	let initialOutputs = $derived(data.initialOutputs);
	let initialSolveResponse = $derived(data.initialSolveResponse);

	// Definition switcher
	let currentDefinition = $derived(data.currentDefinition);
	let _availableDefinitions = $derived(data.availableDefinitions);
	let pageTitle = $derived(schema?.description || schema.name);

	function createInitialValues(s: UISchema | undefined, serverOutputs?: Record<string, unknown>) {
		if (!s) return {};
		const v: Record<string, unknown> = {};

		for (const input of s.inputs) {
			v[input.id] = input.default ?? getDefaultValue(input.paramType);
		}
		for (const output of s.outputs) {
			// Use server-provided initial outputs if available
			v[output.id] = serverOutputs?.[output.id] ?? null;
		}
		return v;
	}

	// Core state
	// values is initialized once per component instance.
	// The {#key} block in markup ensures re-creation when definition changes.
	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, unknown>>(createInitialValues(schema, initialOutputs));
	let error = $state('');
	let computeErrors = $state<string[]>([]);
	let computeWarnings = $state<string[]>([]);

	// Viewer state
	let meshes = $state<any[]>([]);

	// Manual solve mode
	let pendingValues = $state<Record<string, unknown>>({});
	let hasPendingChanges = $state(false);
	let isViewerFullscreen = $state(false);

	// Check if viewer should be shown (either enableLocal or enableRemote)
	const shouldShowViewer = $derived(
		schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote
	);

	// -----------------------------
	// Solve logic
	// -----------------------------

	/** Internal solve function - called by the throttle with AbortSignal */
	async function performSolveInternal(solveValues: Record<string, unknown>, signal: AbortSignal) {
		try {
			// Clear error on new attempt
			error = '';
			computeErrors = [];
			computeWarnings = [];

			const payload = {
				inputs: schema.inputs,
				values: solveValues,
				definitionUrl: ghDefinition // Use server-provided URL
			};

			const res = await fetch('/api/compute', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload),
				signal // Pass abort signal to fetch
			});

			// Check if aborted after fetch completes
			if (signal.aborted) return;

			if (!res.ok) {
				const d = await res.json();
				throw new Error(d.message || 'Compute error');
			}

			const solved = await res.json();

			// Check if aborted before processing
			if (signal.aborted) return;

			// console.log('Solve result:', solved);

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

			Object.assign(values, outputs);
			pendingValues = {};
			hasPendingChanges = false;
		} catch (err) {
			// Don't show error for aborted requests (user cancelled or new request started)
			if (err instanceof Error && err.name === 'AbortError') {
				return;
			}
			error = err instanceof Error ? err.message : String(err);
		}
	}

	// Compute throttle - ensures only one request in-flight, queues latest values
	// 60 second timeout by default
	const computeThrottle = createComputeThrottle<Record<string, unknown>>(performSolveInternal, {
		timeout: 60000
	});

	// Derive solving state from throttle
	let solving = $derived(computeThrottle.isComputing);

	// UI state for debouncing the "Solving..." indicator
	const solvingIndicator = createSolvingIndicator(() => solving);

	// Extract meshes from initial server response on first load (no re-solve)
	$effect(() => {
		if (initialSolveResponse && shouldShowViewer) {
			(async () => {
				try {
					const processor = new GrasshopperResponseProcessor(initialSolveResponse, false);
					meshes = await processor.extractMeshesFromResponse();
				} catch (err) {
					console.error('[InitialLoad] Failed to extract meshes:', err);
				}
			})();
		}
	});

	const computeHealth = useComputeHealth();
	onMount(() => computeHealth.startPeriodicCheck(5000));
	onDestroy(() => computeHealth.stopPeriodicCheck());

	// Register compute health status in footer (reactive via getter)
	useFooterItem(
		'compute-health',
		ComputeHealthFooter,
		() => ({ status: computeHealth.status.status, message: computeHealth.status.message }),
		'left',
		20
	);

	/** Trigger a solve with current values (throttled) */
	function performSolve() {
		computeThrottle.trigger($state.snapshot(values));
	}

	// Track if this is the initial load or a definition change
	let previousDefinition = $state<string>('');
	let isInitialLoad = $state<boolean>(true);

	// Reset state when definition changes and trigger solve (skip on initial load)
	$effect(() => {
		const _ = currentDefinition;

		untrack(() => {
			if (isInitialLoad) {
				// First load - use server-provided data, don't solve
				isInitialLoad = false;
				previousDefinition = currentDefinition;
			} else if (previousDefinition !== currentDefinition) {
				// Definition changed - reset and solve
				meshes = [];
				values = createInitialValues(schema);
				error = '';
				computeErrors = [];
				computeWarnings = [];

				if (schema && Object.keys(values).length > 0) {
					performSolve();
				}

				previousDefinition = currentDefinition;
			}
		});
	});

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

	// Solving badge (shown in header for instant mode only)
	const solvingBadge = $derived(
		schema?.instanceSolve !== false && solvingIndicator.show
			? { label: 'Solving...', variant: 'solving' as const }
			: undefined
	);

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
	<PageContainer errors={computeErrors} warnings={computeWarnings}>
		{#if !isEmbedded}
			<PageHeader title={pageTitle} badge={solvingBadge} showModeToggle={true} />
		{/if}

		<div class="bg-background flex flex-col flex-1 overflow-hidden">
			{#if error}
				<div class="flex min-h-100 items-center justify-center p-8">
					<StateDisplay type="error" size="medium" message={error} />
				</div>
			{:else if !schema}
				<div class="flex min-h-100 items-center justify-center">
					<StateDisplay type="loading" size="large" message="Loading schema..." />
				</div>
			{:else}
				{#key currentDefinition}
					<AppLayout
						{schema}
						{meshes}
						isSolving={solving}
						showSolvingIndicator={schema.instanceSolve !== false && solvingIndicator.show}
						{hasPendingChanges}
						bind:isViewerFullscreen
						bind:values
						onValueChange={handleValueChange}
						environment="compute"
						oncalculate={handleCalculate}
						onLoadValues={async () => {
							if (schema?.instanceSolve !== false) {
								await performSolve();
							} else {
								hasPendingChanges = true;
							}
						}}
					/>
				{/key}
			{/if}
		</div>
	</PageContainer>
</div>

