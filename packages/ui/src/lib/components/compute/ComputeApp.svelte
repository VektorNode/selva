<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import type { ActionButton } from '../../types/actionButton';
	import type { SolveFn } from '@selvajs/solve/shared';
	import type { PresetLabels } from '../../types/presetLabels';
	import { createSolvingIndicator } from '../../compute/solving.svelte';
	import { createRequestResponseDriver } from '@selvajs/solve/client';
	import type {
		RetainedSolveResult,
		SolveEventSource,
		SolveSession,
		SolveSettlement
	} from '@selvajs/solve/client';
	import SolveMessages from './SolveMessages.svelte';
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
	import type { Locale, ViewerMessages } from '../../i18n/messages';
	import { layerLocaleContext } from '../../i18n/localeContext.svelte';

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
		/** Host actions, listed in the panel footer's ⋯ menu after saving and loading inputs. */
		panelActions?: ActionButton[];
		/** Lists "Save inputs…" in the footer menu. */
		showSaveButton?: boolean;
		/** Lists "Load inputs…" in the footer menu. */
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
		 * How long one solve may take before the client aborts it (ms). Pass the same value the
		 * server enforces (`COMPUTE_SOLVE_DEADLINE_MS`), or the client aborts solves that would
		 * have finished.
		 */
		solveDeadlineMs: number;
		/**
		 * Live events for the solves this app runs (`createSolveEventStream`). Pair it with
		 * `streamId` on the `createComputeFetchSolveFn` that backs `onSolve`, or the server has
		 * no stream to route to. Without it the app works as before, just with no mid-solve news.
		 */
		events?: SolveEventSource;
		footerComponent?: any;
		footerComponentProps?: () => Record<string, unknown>;
		footerItemId?: string;
		footerItemPriority?: number;
		// `onReady` fires once, so the result and session are getters rather than snapshots.
		onReady?: (api: {
			loadValues: (values: Record<string, unknown>) => void;
			/** What the viewer is showing — carries `source`/`values` even on a memo hit. Null before the first solve. */
			getLastResult: () => RetainedSolveResult | null;
			/**
			 * For hosts driving solves from their own state. Values written here go through the
			 * same throttle and memo as the UI's, so it's safe to call at interaction rate.
			 */
			getSession: () => SolveSession;
		}) => void;
		/**
		 * Once per settled solve: applied, discarded, blocked, aborted or failed. A result held
		 * for review counts when the user accepts or rejects it, and one a queued solve replaces
		 * never does. Auto-solves from input changes count too.
		 */
		onSolved?: (settlement: SolveSettlement) => void;
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
		// Scopes sessionStorage for external-input values; falls back to definitionKey then schema.id.
		externalScopeKey?: string;
		// Renders client-sourced inputs with presentation === 'slot'.
		clientSlot?: ClientSlot;
		// Language for the app's own chrome, English when unset. Does not translate
		// schema-authored labels or Grasshopper-sourced names/metadata.
		lang?: Locale;
		/**
		 * Replaces individual strings of the app's own chrome, layered over the `lang` catalog
		 * (`VIEWER_MESSAGES`): reword a label, or supply every string for a language with no
		 * built-in catalog. Reaches every component inside, the viewer included. A `{name}`
		 * placeholder in the default is filled the same way in an override. The preset manager's
		 * strings come from `presetLabels` instead.
		 */
		messages?: Partial<ViewerMessages>;
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
		events,
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
		onSolved,
		onViewerReady,
		viewerConfig = {},
		externalScopeKey,
		clientSlot,
		lang,
		messages
	}: Props = $props();

	// Reaches InputControl deep in the tree.
	// svelte-ignore state_referenced_locally
	setClientSlot(clientSlot);

	// Resolution: explicit `lang` → host-provided locale → English, with `messages` on top.
	// Getters, so switching either updates the chrome live.
	const locale = layerLocaleContext(
		() => lang,
		() => messages
	);
	const t = $derived(locale.messages);

	const resolvedScopeKey = $derived(externalScopeKey || definitionKey || schema?.id || '');

	// The session owns the value/lifecycle state machine; the driver is its transport. The
	// session is passed as a getter because the two reference each other.
	// svelte-ignore state_referenced_locally
	const driver = createRequestResponseDriver(onSolve, () => session, {
		solveDeadlineMs,
		// The driver's memo caches whole solve results, meshes included, and the viewer disposes
		// what it renders on the next scene update. `@selvajs/solve` keeps meshes opaque, so the
		// three.js clone/dispose rules come from the renderer that owns them. Without this, a memo
		// hit serves an already-disposed mesh.
		meshPolicy,
		// `isSolving` lives on the driver, which the session can't observe — republish so the
		// spinner and disabled states track it.
		onChange: () => session.notify(),
		events
	});
	// svelte-ignore state_referenced_locally
	const session = useSolveSession({
		schema,
		scopeKey: externalScopeKey || definitionKey || schema?.id || '',
		driver
	});

	let isViewerFullscreen = $state(false);

	const solvingIndicator = createSolvingIndicator(() => session.isSolving);

	// Read at call time, so a host swapping the callback needs no resubscribe.
	$effect(() => session.onSettled((settlement) => onSolved?.(settlement)));

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
	// stays live — the renderer calls it every render to keep the footer in sync.
	useFooterItem({
		id: untrack(() => footerItemId),
		component: untrack(() => footerComponent),
		getProps: () => footerComponentProps?.() ?? {},
		position: 'left',
		priority: untrack(() => footerItemPriority)
	});

	let resolvedIsEmbedded = $derived(isEmbedded ?? page.url.searchParams.get('embed') === 'true');
	let resolvedPrimaryColor = $derived(primaryColor ?? page.url.searchParams.get('primary'));
	let primaryOverride = $derived(
		resolvedPrimaryColor ? hexToOklch(resolvedPrimaryColor) : undefined
	);

	let pageTitle = $derived(title ?? (schema?.description || schema.name));
</script>

<div class="contents" style:--primary={primaryOverride}>
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
		diagnostics={session.diagnostics}
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
					showViewer={!!schema.viewerOptions?.enableRemote}
					meshes={session.meshes}
					isSolving={session.isSolving}
					showSolvingIndicator={solvingIndicator.show}
					solveIsSlow={solvingIndicator.slow}
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
					ensureSolved={() => session.ensureSolved()}
					onLoadValues={() => session.loadValues({})}
				/>
			{/key}
		{/if}
	</AppShell>
</div>

<SolveMessages
	live={session.live}
	phase={session.phase}
	diagnostics={session.diagnostics}
	onabort={() => session.abort()}
	onconfirm={() => session.acknowledge()}
	ondiscard={() => session.discard()}
/>
