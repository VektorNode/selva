<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { UISchema } from '../types/generated';
	import type { ActionButton } from '../types/actionButton';
	import type { SolveFn } from '../types/solveFn';
	import { getDefaultValue } from '../utils/utils-shared';
	import { createComputeThrottle } from '../utils/computeThrottle.svelte';
	import { createSolvingIndicator } from '../utils/solving.svelte';
	import { useFooterItem } from '../composables/useFooterItem.svelte';
	import { hexToOklch } from '../utils/color';
	import { APP_DEFAULTS } from '../constants';
	import PageContainer from './layout/PageContainer.svelte';
	import PageHeader from './layout/PageHeader.svelte';
	import AppLayout from './AppLayout.svelte';
	import StateDisplay from './ui/StateDisplay.svelte';

	// ── Props ────────────────────────────────────────────────────────────────────
	import type { Snippet } from 'svelte';

	interface Props {
		schema: UISchema;
		onSolve: SolveFn;
		definitionKey?: string;
		title?: string;
		isEmbedded?: boolean;
		primaryColor?: string;
		showModeToggle?: boolean;
		stateManagerActions?: ActionButton[];
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		footerComponent?: any;
		footerComponentProps?: () => Record<string, unknown>;
		footerItemId?: string;
		footerItemPriority?: number;
		// Callback to expose the loadValues function to the parent
		// Usage: bind:loadValues={myLoadFn} or onReady={({ loadValues }) => ...}
		onReady?: (api: { loadValues: (values: Record<string, unknown>) => void }) => void;
		// Snippets for custom layout
		header?: Snippet;
		children?: Snippet<[{ errors: string[]; warnings: string[] }]>;
	}

	let {
		schema,
		onSolve,
		definitionKey = '',
		title,
		isEmbedded,
		primaryColor,
		showModeToggle = false,
		stateManagerActions = [],
		showSaveButton = true,
		showLoadButton = true,
		footerComponent,
		footerComponentProps,
		footerItemId = 'footer-item',
		footerItemPriority = 0,
		header,
		children,
		onReady
	}: Props = $props();

	// ── Helpers ──────────────────────────────────────────────────────────────────
	function createInitialValues(s: UISchema) {
		const v: Record<string, unknown> = {};
		for (const input of s.inputs) {
			v[input.id] = input.default ?? getDefaultValue(input.paramType);
		}
		for (const output of s.outputs) {
			v[output.id] = null;
		}
		return v;
	}

	// ── Core state ───────────────────────────────────────────────────────────────
	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, unknown>>(createInitialValues(schema));
	let error = $state('');
	let computeErrors = $state<string[]>([]);
	let computeWarnings = $state<string[]>([]);
	let meshes = $state<any[]>([]);
	let pendingValues = $state<Record<string, unknown>>({});
	// svelte-ignore state_referenced_locally
	let hasPendingChanges = $state(schema?.instanceSolve === false);
	// svelte-ignore state_referenced_locally
	let hasNeverSolved = $state(schema?.instanceSolve === false);
	let isViewerFullscreen = $state(false);

	// ── Solve logic ──────────────────────────────────────────────────────────────
	async function performSolveInternal(solveValues: Record<string, unknown>, signal: AbortSignal) {
		try {
			error = '';
			computeErrors = [];
			computeWarnings = [];

			const result = await onSolve(solveValues, signal);

			if (signal.aborted) return;

			computeErrors = result.errors ?? [];
			computeWarnings = result.warnings ?? [];
			meshes = result.meshes ?? [];

			Object.assign(values, result.outputs);
			pendingValues = {};
			hasPendingChanges = false;
			hasNeverSolved = false;
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') return;
			error = err instanceof Error ? err.message : String(err);
		}
	}

	const computeThrottle = createComputeThrottle<Record<string, unknown>>(performSolveInternal, {
		timeout: APP_DEFAULTS.TIMEOUTS.COMPUTE_TIMEOUT
	});

	let solving = $derived(computeThrottle.isComputing);
	const solvingIndicator = createSolvingIndicator(() => solving);

	function performSolve() {
		computeThrottle.trigger($state.snapshot(values));
	}

	function loadValues(incoming: Record<string, unknown>) {
		Object.assign(values, incoming);
		if (schema?.instanceSolve !== false) {
			performSolve();
		} else {
			hasPendingChanges = true;
		}
	}

	$effect(() => {
		onReady?.({ loadValues });
	});

	let previousDefinitionKey = $state('');
	let isInitialLoad = $state(true);

	$effect(() => {
		const _ = definitionKey;

		untrack(() => {
			if (isInitialLoad) {
				isInitialLoad = false;
				previousDefinitionKey = definitionKey;
				if (schema?.instanceSolve !== false) {
					performSolve();
				}
			} else if (previousDefinitionKey !== definitionKey) {
				meshes = [];
				values = createInitialValues(schema);
				error = '';
				computeErrors = [];
				computeWarnings = [];
				if (schema && Object.keys(values).length > 0) {
					performSolve();
				}
				previousDefinitionKey = definitionKey;
			}
		});
	});

	// ── Handlers ─────────────────────────────────────────────────────────────────
	async function handleValueChange(id: string, val: unknown) {
		values[id] = val;

		if (schema?.instanceSolve === false) {
			pendingValues[id] = val;
			hasPendingChanges = true;
			return;
		}

		performSolve();
	}

	function handleCalculate() {
		performSolve();
	}

	// ── Footer item ──────────────────────────────────────────────────────────────
	// Use untrack to read these static props without creating reactive dependencies.
	// footerComponentProps is intentionally NOT untracked — it's a getter called every render.
	const _footerItemId = untrack(() => footerItemId);
	const _footerComponent = untrack(() => footerComponent);
	const _footerItemPriority = untrack(() => footerItemPriority);
	useFooterItem(
		_footerItemId,
		_footerComponent,
		() => (_footerComponent ? (footerComponentProps?.() ?? {}) : {}),
		'left',
		_footerItemPriority
	);

	// ── Embed + custom style ─────────────────────────────────────────────────────
	let resolvedIsEmbedded = $derived(isEmbedded ?? page.url.searchParams.get('embed') === 'true');
	let resolvedPrimaryColor = $derived(primaryColor ?? page.url.searchParams.get('primary'));
	let customStyle = $derived(
		resolvedPrimaryColor ? `--primary: ${hexToOklch(resolvedPrimaryColor)}` : ''
	);

	let pageTitle = $derived(title ?? (schema?.description || schema.name));
</script>

<div style={customStyle} style:display="contents">
	{#if children}
		{@render children({ errors: computeErrors, warnings: computeWarnings })}
	{:else}
		<PageContainer errors={computeErrors} warnings={computeWarnings}>
			{#if header}
				{@render header()}
			{:else if !resolvedIsEmbedded}
				<PageHeader title={pageTitle} {showModeToggle} />
			{/if}

			<div class="flex flex-1 flex-col overflow-hidden bg-background">
				{#if error}
					<div class="min-h-100 p-8 flex items-center justify-center">
						<StateDisplay type="error" size="medium" message={error} />
					</div>
				{:else if !schema}
					<div class="min-h-100 flex items-center justify-center">
						<StateDisplay type="loading" size="large" message="Loading schema..." />
					</div>
				{:else}
					{#key definitionKey}
						<AppLayout
							{schema}
							{meshes}
							isSolving={solving}
							showSolvingIndicator={schema.instanceSolve !== false && solvingIndicator.show}
							{hasPendingChanges}
							{hasNeverSolved}
							bind:isViewerFullscreen
							bind:values
							{stateManagerActions}
							{showSaveButton}
							{showLoadButton}
							onValueChange={handleValueChange}
							oncalculate={handleCalculate}
							onLoadValues={() => {
								if (schema?.instanceSolve !== false) {
									performSolve();
								} else {
									hasPendingChanges = true;
								}
							}}
						/>
					{/key}
				{/if}
			</div>
		</PageContainer>
	{/if}
</div>
