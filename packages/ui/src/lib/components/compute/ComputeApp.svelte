<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import type { ActionButton } from '../../types/actionButton';
	import type { SolveFn } from '@selvajs/solve/shared';
	import type { PresetLabels } from '../../types/presetLabels';
	import { createSolvingIndicator } from '../../compute/solving.svelte';
	import { createRequestResponseDriver } from '@selvajs/solve/client';
	import type { RetainedSolveResult } from '@selvajs/solve/client';
	import { meshPolicy } from '@selvajs/visualization/parse';
	import { useSolveSession } from '../../compute/useSolveSession.svelte';
	import { useFooterItem } from '../../composables/useFooterItem.svelte';
	import { hexToOklch } from '../../utils/color';
	import AppShell from '../layout/AppShell.svelte';
	import AppLayout from './AppLayout.svelte';
	import StateDisplay from '../primitives/StateDisplay.svelte';
	import { setClientSlot, type ClientSlot } from '../../contexts/clientSlotContext.svelte';
	import type { Locale } from '../../i18n/messages';
	import { setLocaleContext, getLocaleContext } from '../../i18n/localeContext.svelte';

	import type { Snippet } from 'svelte';

	interface Props {
		schema: UISchema;
		onSolve: SolveFn;
		definitionKey?: string;
		title?: string;
		/** Branding logo URL shown as a watermark in the viewer's bottom-right corner. Hidden when unset. */
		logo?: string;
		isEmbedded?: boolean;
		primaryColor?: string;
		showModeToggle?: boolean;
		panelActions?: ActionButton[];
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		/** When set, persist saved states via this callback instead of downloading a .slvp file. */
		onSaveState?: (state: ParameterPreset) => void | Promise<void>;
		/** When set, the Load dialog lists these states instead of showing a file input. */
		onListStates?: () => ParameterPreset[] | Promise<ParameterPreset[]>;
		/** Partial overrides for the preset-manager UI strings (e.g. for localization). */
		presetLabels?: Partial<PresetLabels>;
		/** Name shown in the footer copyright line. Defaults to the brand name ("Selva"). */
		copyrightName?: string;
		/** Fully overrides the footer copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		/**
		 * How long one solve may take before the client aborts it (ms). Required: pass
		 * the same value the server enforces (`COMPUTE_SOLVE_DEADLINE_MS`), so the client
		 * doesn't abort a solve that would have finished.
		 */
		solveDeadlineMs: number;
		footerComponent?: any;
		footerComponentProps?: () => Record<string, unknown>;
		footerItemId?: string;
		footerItemPriority?: number;
		onReady?: (api: {
			loadValues: (values: Record<string, unknown>) => void;
			/**
			 * The last result reported to the session — the one the viewer is showing, carrying
			 * `source`/`values` even when a memo hit served it. Null before the first solve.
			 * A getter, not a snapshot: `onReady` fires once.
			 */
			getLastResult: () => RetainedSolveResult | null;
		}) => void;
		headerRight?: Snippet;
		// Replaces the built-in header; takes precedence over `headerRight`.
		header?: Snippet;
		// Scopes sessionStorage for external-input values; falls back to definitionKey then schema.id.
		externalScopeKey?: string;
		// Renders client-sourced inputs with presentation === 'slot'; receives { inputId, displayName, value, onValueChange }.
		clientSlot?: ClientSlot;
		/**
		 * UI language for the app's own chrome (viewer, panels, status text).
		 * Provided once here and read by every descendant via locale context.
		 * Defaults to English when unset. Does not translate schema-authored labels
		 * or Grasshopper-sourced names/metadata.
		 */
		lang?: Locale;
	}

	let {
		schema,
		onSolve,
		definitionKey = '',
		title,
		logo,
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
		solveDeadlineMs,
		footerComponent,
		footerComponentProps,
		footerItemId = 'footer-item',
		footerItemPriority = 0,
		headerRight,
		header,
		onReady,
		externalScopeKey,
		clientSlot,
		lang
	}: Props = $props();

	// Make the host's client-input slot available to InputControl deep in the tree.
	// svelte-ignore state_referenced_locally
	setClientSlot(clientSlot);

	// Provide the UI locale once for the whole app subtree (viewer, panels, status
	// text). Resolution: explicit `lang` → any host-provided locale → English. The
	// getter is re-read reactively, so switching `lang` updates the chrome live.
	const hostLocale = getLocaleContext();
	setLocaleContext(() => lang ?? hostLocale.locale);
	const t = $derived(getLocaleContext().messages);

	const resolvedScopeKey = $derived(externalScopeKey || definitionKey || schema?.id || '');

	// Solve Session owns the value/lifecycle state machine; the request/response driver
	// gives it its transport (Rhino.Compute over HTTP via onSolve, throttled). The driver
	// reads the reporter lazily so it can capture the session it's wired into.
	// svelte-ignore state_referenced_locally
	const driver = createRequestResponseDriver(onSolve, () => session, {
		solveDeadlineMs,
		// The driver's result memo caches whole solve results, meshes included — and the viewer
		// disposes what it renders on the next scene update. `@selvajs/solve` keeps meshes opaque,
		// so the three.js clone/dispose rules are injected from the renderer that owns them
		// (audit C1). Without this a memo hit serves an already-disposed mesh.
		meshPolicy,
		// `session.isSolving` forwards to the driver, which the session can't observe on its
		// own — republish so the spinner and disabled states track it. Deferred into a
		// callback, so it reads `session` after initialization rather than during it.
		onChange: () => session.notify()
	});
	// svelte-ignore state_referenced_locally
	const session = useSolveSession({
		schema,
		scopeKey: externalScopeKey || definitionKey || schema?.id || '',
		driver
	});

	let isViewerFullscreen = $state(false);

	const solvingIndicator = createSolvingIndicator(() => session.isSolving);

	$effect(() => {
		onReady?.({
			loadValues: (incoming) => session.loadValues(incoming),
			getLastResult: () => session.lastResult
		});
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
					session.solve();
				}
			} else if (previousDefinitionKey !== definitionKey) {
				// Host owns the WHEN (definitionKey changed); session owns the WHAT.
				session.rebuild(schema, resolvedScopeKey);
				previousDefinitionKey = definitionKey;
			}
		});
	});

	function handleValueChange(id: string, val: unknown, forceSolve = false) {
		session.setValue(id, val, forceSolve);
	}

	function handleCalculate() {
		session.solve();
	}

	// Read static props without creating reactive dependencies (registration is fixed at
	// mount). footerComponentProps is intentionally read live — it's a getter the renderer
	// calls every render to keep the footer in sync. The composable no-ops when component
	// is absent, so the hook itself stays unconditional.
	useFooterItem({
		id: untrack(() => footerItemId),
		component: untrack(() => footerComponent),
		getProps: () => footerComponentProps?.() ?? {},
		position: 'left',
		priority: untrack(() => footerItemPriority)
	});

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
		errors={session.computeErrors}
		warnings={session.computeWarnings}
	>
		{#if session.error}
			<div class="min-h-100 p-8 flex items-center justify-center">
				<StateDisplay type="error" size="medium" message={session.error} />
			</div>
		{:else if !schema}
			<div class="min-h-100 flex items-center justify-center">
				<StateDisplay type="loading" size="large" message={t.loadingSchema} />
			</div>
		{:else}
			{#key definitionKey}
				<AppLayout
					{schema}
					meshes={session.meshes}
					isSolving={session.isSolving}
					showSolvingIndicator={schema.instanceSolve !== false && solvingIndicator.show}
					hasPendingChanges={session.hasPendingChanges}
					hasNeverSolved={session.hasNeverSolved}
					bind:isViewerFullscreen
					values={session.values}
					logoUrl={logo}
					{panelActions}
					{showSaveButton}
					{showLoadButton}
					{onSaveState}
					{onListStates}
					{presetLabels}
					onValueChange={handleValueChange}
					oncalculate={handleCalculate}
					onLoadValues={() => session.loadValues({})}
				/>
			{/key}
		{/if}
	</AppShell>
</div>
