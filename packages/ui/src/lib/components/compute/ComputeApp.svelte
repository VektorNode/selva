<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import type { ActionButton } from '../../types/actionButton';
	import type { SolveFn } from '../../types/solveFn';
	import type { PresetLabels } from '../../types/presetLabels';
	import { getDefaultValue } from '../../schema/defaults';
	import { createComputeThrottle } from '../../compute/computeThrottle.svelte';
	import { createSolvingIndicator } from '../../compute/solving.svelte';
	import { useFooterItem } from '../../composables/useFooterItem.svelte';
	import { hexToOklch } from '../../utils/color';
	import AppShell from '../layout/AppShell.svelte';
	import AppLayout from './AppLayout.svelte';
	import StateDisplay from '../primitives/StateDisplay.svelte';
	import { getExternalInputs, readExternalValue } from '../../external/storage';

	import type { Snippet } from 'svelte';

	interface Props {
		schema: UISchema;
		onSolve: SolveFn;
		definitionKey?: string;
		title?: string;
		isEmbedded?: boolean;
		primaryColor?: string;
		showModeToggle?: boolean;
		panelActions?: ActionButton[];
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		/** When set, persist saved states via this callback instead of downloading a .sps file. */
		onSaveState?: (state: ParameterPreset) => void | Promise<void>;
		/** When set, the Load dialog lists these states instead of showing a file input. */
		onListStates?: () => ParameterPreset[] | Promise<ParameterPreset[]>;
		/** Partial overrides for the preset-manager UI strings (e.g. for localization). */
		presetLabels?: Partial<PresetLabels>;
		/** Name shown in the footer copyright line. Defaults to the brand name ("Selva"). */
		copyrightName?: string;
		/** Fully overrides the footer copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		/** Per-solve abort timeout (ms). Falls back to createComputeThrottle's default. */
		solveTimeoutMs?: number;
		footerComponent?: any;
		footerComponentProps?: () => Record<string, unknown>;
		footerItemId?: string;
		footerItemPriority?: number;
		onReady?: (api: { loadValues: (values: Record<string, unknown>) => void }) => void;
		headerRight?: Snippet;
		/**
		 * Bring-your-own header. When provided, replaces the built-in header inside
		 * the standard-height sticky bar (so the fixed layout is unaffected).
		 * Takes precedence over `headerRight`.
		 */
		header?: Snippet;
		/**
		 * Stable identifier used to scope sessionStorage entries for external-input
		 * values. If absent, falls back to definitionKey, then to schema.id.
		 */
		externalScopeKey?: string;
	}

	let {
		schema,
		onSolve,
		definitionKey = '',
		title,
		isEmbedded,
		primaryColor,
		showModeToggle = false,
		panelActions = [],
		showSaveButton = true,
		showLoadButton = true,
		onSaveState,
		onListStates,
		presetLabels,
		copyrightName,
		footerText,
		solveTimeoutMs,
		footerComponent,
		footerComponentProps,
		footerItemId = 'footer-item',
		footerItemPriority = 0,
		headerRight,
		header,
		onReady,
		externalScopeKey
	}: Props = $props();

	const resolvedScopeKey = $derived(externalScopeKey || definitionKey || schema?.id || '');

	function createInitialValues(s: UISchema, scopeKey: string) {
		const externalSet = new Set(getExternalInputs(s).map((e) => e.paramId));
		const v: Record<string, unknown> = {};
		for (const input of s.inputs) {
			if (externalSet.has(input.id)) {
				const stored = readExternalValue({ scopeKey, inputId: input.id });
				if (stored !== undefined) v[input.id] = stored;
				// else: leave undefined so the missing-inputs panel can detect it
				continue;
			}
			v[input.id] = input.default ?? getDefaultValue(input.paramType);
		}
		for (const output of s.outputs) {
			v[output.id] = null;
		}
		return v;
	}

	// svelte-ignore state_referenced_locally
	let values = $state<Record<string, unknown>>(
		createInitialValues(schema, externalScopeKey || definitionKey || schema?.id || '')
	);
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

	// svelte-ignore state_referenced_locally
	const computeThrottle = createComputeThrottle<Record<string, unknown>>(performSolveInternal, {
		timeout: solveTimeoutMs
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
				values = createInitialValues(schema, resolvedScopeKey);
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

	let resolvedIsEmbedded = $derived(isEmbedded ?? page.url.searchParams.get('embed') === 'true');
	let resolvedPrimaryColor = $derived(primaryColor ?? page.url.searchParams.get('primary'));
	let customStyle = $derived(
		resolvedPrimaryColor ? `--primary: ${hexToOklch(resolvedPrimaryColor)}` : ''
	);

	let pageTitle = $derived(title ?? (schema?.description || schema.name));
</script>

<div style={customStyle} style:display="contents">
	<AppShell
		mode="fixed"
		showHeader={!resolvedIsEmbedded}
		showFooter
		title={pageTitle}
		{showModeToggle}
		{copyrightName}
		{footerText}
		{header}
		rightContent={headerRight}
		errors={computeErrors}
		warnings={computeWarnings}
	>
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
					{panelActions}
					{showSaveButton}
					{showLoadButton}
					{onSaveState}
					{onListStates}
					{presetLabels}
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
	</AppShell>
</div>
