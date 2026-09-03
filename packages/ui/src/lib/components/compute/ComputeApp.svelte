<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import type { ActionButton } from '../../types/actionButton';
	import type { SolveFn } from '@selvajs/solve/shared';
	import type { PresetLabels } from '../../types/presetLabels';
	import { createSolvingIndicator } from '../../compute/solving.svelte';
	import { createRequestResponseDriver } from '@selvajs/solve/client';
	import type { RetainedSolveResult, SolveSession } from '@selvajs/solve/client';
	import { meshPolicy } from '@selvajs/visualization/parse';
	import type { ThreeViewer } from '@selvajs/visualization/render';
	import { useSolveSession } from '../../compute/useSolveSession.svelte';
	import { useFooterItem } from '../../composables/useFooterItem.svelte';
	import { hexToOklch } from '../../utils/color';
	import AppShell from '../layout/AppShell.svelte';
	import AppLayout from './AppLayout.svelte';
	import { type ViewerConfig } from '../viewer/Viewer.svelte';
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
		/** Watermark shown in the viewer's bottom-right corner. */
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
		/** Name in the footer copyright line. Defaults to the brand name ("Selva"). */
		copyrightName?: string;
		/** Fully overrides the footer copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		/**
		 * Max time one solve may take before the client aborts it (ms). Pass the same value the
		 * server enforces (`COMPUTE_SOLVE_DEADLINE_MS`), or the client aborts solves that would
		 * have finished.
		 */
		solveDeadlineMs: number;
		footerComponent?: any;
		footerComponentProps?: () => Record<string, unknown>;
		footerItemId?: string;
		footerItemPriority?: number;
		// Fires once, so the result and session are getters, not snapshots.
		onReady?: (api: {
			loadValues: (values: Record<string, unknown>) => void;
			/** What the viewer is showing: carries `source`/`values` even on a memo hit. Null before the first solve. */
			getLastResult: () => RetainedSolveResult | null;
			/**
			 * For hosts driving solves from their own state. Values written here go through the
			 * same throttle and memo as the UI's, so it's safe to call at interaction rate.
			 */
			getSession: () => SolveSession;
		}) => void;
		/** Hands the live three.js viewer to the host once it mounts. See `Viewer.svelte` for the contract. */
		onViewerReady?: (viewer: ThreeViewer) => void | (() => void);
		/** Viewer chrome and defaults. `backgroundColor` and `showSceneManager` are set by the layout. */
		viewerConfig?: ViewerConfig;
		headerRight?: Snippet;
		// Primary nav rendered next to the brand, so the viewer keeps the app-wide nav.
		navItems?: Snippet;
		homeUrl?: string;
		brandName?: string;
		// Replaces the built-in header; takes precedence over `headerRight`.
		header?: Snippet;
		// Scopes sessionStorage for external-input values.
		externalScopeKey?: string;
		// Renders client-sourced inputs with presentation === 'slot'.
		clientSlot?: ClientSlot;
		// Language for the app's own chrome, English when unset. Does not translate
		// schema-authored labels or Grasshopper-sourced names/metadata.
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
		navItems,
		homeUrl,
		brandName,
		header,
		onReady,
		onViewerReady,
		viewerConfig = {},
		externalScopeKey,
		clientSlot,
		lang
	}: Props = $props();

	// Reaches InputControl deep in the tree.
	// svelte-ignore state_referenced_locally
	setClientSlot(clientSlot);

	// Read the host's locale before overriding it for our subtree.
	const hostLocale = getLocaleContext();
	setLocaleContext(() => lang ?? hostLocale.locale);
	const t = $derived(getLocaleContext().messages);

	const resolvedScopeKey = $derived(externalScopeKey || definitionKey || schema?.id || '');

	// The session owns the value/lifecycle state machine; the driver is its transport. The
	// session is passed as a getter because the two reference each other.
	// svelte-ignore state_referenced_locally
	const driver = createRequestResponseDriver(onSolve, () => session, {
		solveDeadlineMs,
		// Required: without it, a memo hit serves a mesh the viewer already disposed. See CONTEXT.md.
		meshPolicy,
		// `isSolving` lives on the driver, which the session can't observe. Republish so the
		// spinner and disabled states track it.
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
			getLastResult: () => session.lastResult,
			getSession: () => session
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

	// Registration is fixed at mount, so the static props are untracked. `footerComponentProps`
	// stays live: the renderer calls it every render to keep the footer in sync.
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
		{navItems}
		{homeUrl}
		{brandName}
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
					{onViewerReady}
					{viewerConfig}
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
