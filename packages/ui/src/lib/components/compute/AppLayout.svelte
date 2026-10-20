<script lang="ts">
	import type { UISchema, SupportedTypes, ParameterPreset } from '@selvajs/schemas';
	import type { SolveSettlement } from '@selvajs/solve/client';
	import type { ActionButton } from '../../types/actionButton';
	import type { PresetLabels } from '../../types/presetLabels';
	import { ChevronUp, Download, Ellipsis, Upload } from '@lucide/svelte';
	import type { ThreeViewer } from '@selvajs/visualization/render';
	import Viewer, { type ViewerConfig } from '../viewer/Viewer.svelte';
	import CalculateButton from '../primitives/CalculateButton.svelte';
	import SolvingIndicator from '../primitives/SolvingIndicator.svelte';
	import TabLayout from '../preview/TabLayout.svelte';
	import CollapsedPanelStrip from './CollapsedPanelStrip.svelte';
	import * as Resizable from '$lib/components/primitives/resizable';
	import * as DropdownMenu from '$lib/components/primitives/dropdown-menu/index.js';
	import { Button } from '$lib';
	import ParameterPresetManager from './ParameterPresetManager.svelte';
	import { runPanelAction } from '../../compute/run-panel-action';
	import { getLocaleContext } from '../../i18n/localeContext.svelte';
	import { buildVisibilityMap, isTabVisible, itemKey } from '../../schema/visibility-rules';
	import { DEFAULT_PRESET_LABELS } from '../../types/presetLabels';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const COLLAPSED_WIDTH = 48;

	interface Props {
		schema: UISchema;
		meshes?: any[];
		isSolving: boolean;
		showSolvingIndicator?: boolean;
		hasPendingChanges?: boolean;
		hasNeverSolved?: boolean;
		isViewerFullscreen?: boolean;
		oncalculate?: () => void;
		/**
		 * The result for the current inputs, solving if it must (`session.ensureSolved`). Needed
		 * by `solvesFirst` actions; without it they run straight away.
		 */
		ensureSolved?: () => Promise<SolveSettlement>;
		values: Record<string, unknown>;
		onValueChange: (id: string, val: SupportedTypes, forceSolve?: boolean) => void | Promise<void>;
		onLoadValues?: (values: Record<string, unknown>) => void | Promise<void>;
		panelActions?: ActionButton[];
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		onSaveState?: (state: ParameterPreset) => void | Promise<void>;
		onListStates?: () => ParameterPreset[] | Promise<ParameterPreset[]>;
		presetLabels?: Partial<PresetLabels>;
		viewerConfig?: ViewerConfig;
		logoUrl?: string;
		onViewerReady?: (viewer: ThreeViewer) => void | (() => void);
	}

	let {
		schema,
		meshes = [],
		isSolving,
		showSolvingIndicator = false,
		hasPendingChanges = false,
		hasNeverSolved = false,
		isViewerFullscreen = $bindable(false),
		oncalculate = () => {},
		ensureSolved,
		values,
		onValueChange,
		onLoadValues,
		panelActions = [],
		showSaveButton = true,
		showLoadButton = true,
		onSaveState,
		onListStates,
		presetLabels,
		viewerConfig = {},
		logoUrl,
		onViewerReady
	}: Props = $props();

	const presetText = $derived({ ...DEFAULT_PRESET_LABELS, ...presetLabels });
	let presets = $state<ParameterPresetManager | null>(null);
	const hasMenu = $derived(showSaveButton || showLoadButton || panelActions.length > 0);
	const resultIsStale = $derived(hasPendingChanges || hasNeverSolved);

	const hasViewer = $derived(
		!!(schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote)
	);
	const shownTabs = $derived(
		schema.layout.type === 'tabbed'
			? schema.layout.tabs.filter((tab) => isTabVisible(tab, values))
			: []
	);
	// A hidden or disabled input still solves, so reset it to its default — otherwise the
	// value the user last set while it was visible keeps feeding the definition. Lives here,
	// not in TabLayout: a panel whose tabs all hide unmounts and would miss the reset.
	$effect(() => {
		if (schema.layout.type !== 'tabbed') return;
		const updates: Record<string, unknown> = {};
		schema.layout.tabs.forEach((tab) =>
			tab.groups.forEach((group) => {
				const visibilityMap = buildVisibilityMap(group.items, values);
				group.items.forEach((layoutItem) => {
					if (layoutItem.type === 'linebreak') return;
					const { visible, disabled, defaultValue } = visibilityMap[itemKey(layoutItem)];
					const input = schema.inputs.find((i) => i.id === layoutItem.paramId);
					if (!input || defaultValue === undefined) return;
					if ((!visible || disabled) && values[input.id] !== defaultValue) {
						updates[input.id] = defaultValue;
					}
				});
			})
		);
		if (Object.keys(updates).length > 0) Object.assign(values, updates);
	});

	const leftTabs = $derived(shownTabs.filter((t) => t.position !== 'right'));
	const rightTabs = $derived(shownTabs.filter((t) => t.position === 'right'));
	const hasLeftPanel = $derived(leftTabs.length > 0);
	const hasRightPanel = $derived(rightTabs.length > 0);
	const hasSidebar = $derived(hasViewer || hasRightPanel);
	// Left + right, no viewer — both panes grow to fill the full width.
	const isTwoPanelMode = $derived(!hasViewer && hasLeftPanel && hasRightPanel);

	let isMobile = $state(false);
	let drawerOpen = $state(false);

	const activeLeftTabLabel = $derived(leftTabs[0]?.label ?? t.parametersTab);

	$effect(() => {
		const mqMobile = window.matchMedia('(max-width: 639px)');
		function update() {
			isMobile = mqMobile.matches;
		}
		update();
		mqMobile.addEventListener('change', update);
		return () => mqMobile.removeEventListener('change', update);
	});

	let leftCollapsed = $state(false);
	let rightCollapsed = $state(false);
	let leftPaneRef = $state<{ expand: () => void } | null>(null);
	let rightPaneRef = $state<{ expand: () => void } | null>(null);
	let requestedLeftTabId = $state<string | null>(null);
	let requestedRightTabId = $state<string | null>(null);

	const layoutKey = $derived(
		`${hasLeftPanel ? 'L' : ''}${hasViewer ? 'V' : ''}${hasRightPanel ? 'R' : ''}`
	);

	async function handleLoadValues(loadedValues: Record<string, unknown>) {
		Object.assign(values, loadedValues);
		await onLoadValues?.(loadedValues);
	}

	let _touchStartY = 0;

	function onDrawerTouchStart(e: TouchEvent) {
		_touchStartY = e.touches[0].clientY;
	}

	function onDrawerTouchEnd(e: TouchEvent) {
		const deltaY = e.changedTouches[0].clientY - _touchStartY;
		const SWIPE_THRESHOLD = 40;
		if (Math.abs(deltaY) > SWIPE_THRESHOLD) {
			drawerOpen = deltaY < 0; // swipe up → open, swipe down → close
		}
	}
</script>

<!-- Everything but Calculate: saving and loading inputs, then the host's own actions. -->
{#snippet actionsMenu()}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					size="icon-lg"
					class="shrink-0"
					title={t.moreActions}
					aria-label={t.moreActions}
				>
					<Ellipsis />
				</Button>
			{/snippet}
		</DropdownMenu.Trigger>
		<!-- Above the fullscreen viewer, which sits at z-index 10000. -->
		<DropdownMenu.Content side="top" align="end" sideOffset={6} class="min-w-56 z-10001 w-auto">
			{#if showSaveButton}
				<DropdownMenu.Item onSelect={() => presets?.openSave()}>
					<Download />
					{presetText.saveMenuItem}
				</DropdownMenu.Item>
			{/if}
			{#if showLoadButton}
				<DropdownMenu.Item onSelect={() => presets?.openLoad()}>
					<Upload />
					{presetText.loadMenuItem}
				</DropdownMenu.Item>
			{/if}
			{#if (showSaveButton || showLoadButton) && panelActions.length > 0}
				<DropdownMenu.Separator />
			{/if}
			{#each panelActions as action (action.id)}
				{@const hint =
					action.hint ?? (action.solvesFirst && resultIsStale ? t.calculatesFirst : undefined)}
				<DropdownMenu.Item
					disabled={action.disabled}
					variant={action.variant ?? 'default'}
					onSelect={() => runPanelAction(action, ensureSolved)}
					class="items-start"
				>
					{#if action.icon}
						{@const IconComponent = action.icon}
						<IconComponent class="mt-0.5" />
					{/if}
					<span class="flex flex-col">
						{action.label}
						{#if hint}
							<span class="text-xs leading-snug text-muted-foreground">{hint}</span>
						{/if}
					</span>
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/snippet}

<!-- One primary action and one menu. A definition that solves on every change has no Calculate,
     so the menu sits alone at the end of the row. -->
{#snippet footer()}
	{#if schema.instanceSolve === false}
		<CalculateButton
			{hasPendingChanges}
			{hasNeverSolved}
			{isSolving}
			{oncalculate}
			trailing={hasMenu ? actionsMenu : undefined}
		/>
	{:else if hasMenu}
		<div class="mt-3 pb-3 pt-2 px-2 flex justify-end border-t border-border/50">
			{@render actionsMenu()}
		</div>
	{/if}
{/snippet}

<!-- `hostsFooter` marks the one panel that carries the footer. On a phone the footer moves to the
     drawer's pinned bottom instead. -->
{#snippet panelContent(
	panelFilter: 'left' | 'right' | undefined,
	requestedTabId: string | null,
	hostsFooter = true
)}
	<div class="panel-content-wrapper">
		{#if schema.layout.type === 'tabbed'}
			<TabLayout {schema} {values} {onValueChange} {panelFilter} {requestedTabId} />
		{/if}
		{#if hostsFooter && !isMobile}
			<div class="panel-footer px-1">
				{@render footer()}
			</div>
		{/if}
	</div>
{/snippet}

<!-- Pinned under the scrolling fields, so the primary action never sits at the end of a long list. -->
{#snippet drawerFooter(isInert: boolean)}
	<div class="drawer-footer" inert={isInert}>
		{@render footer()}
	</div>
{/snippet}

<main
	data-layout-root
	class="min-h-0 sm:flex-row sm:py-(--page-py) flex flex-1 flex-col overflow-hidden {leftCollapsed
		? 'sm:pl-0'
		: 'sm:pl-(--page-px)'} {rightCollapsed ? 'sm:pr-0' : 'sm:pr-(--page-px)'}"
	class:fullscreen-layout={isViewerFullscreen}
	class:relative={isMobile}
>
	{#if isMobile}
		{#if hasViewer}
			<div class="min-h-0 flex flex-1 flex-col">
				<Viewer
					{meshes}
					bind:isFullscreen={isViewerFullscreen}
					{isSolving}
					isBlurred={drawerOpen}
					{drawerOpen}
					{logoUrl}
					{onViewerReady}
					viewerConfig={{
						...viewerConfig,
						backgroundColor: schema?.viewerOptions?.backgroundColor,
						showSceneManager: false
					}}
				/>
			</div>

			<div
				class="drawer-container rounded-t-2xl z-40 border-t bg-background shadow-sheet"
				class:drawer-open={drawerOpen}
				class:drawer-closed={!drawerOpen}
			>
				<!-- Named by its visible label; aria-expanded carries the open/closed state. -->
				<button
					class="drawer-handle-bar"
					onclick={() => (drawerOpen = !drawerOpen)}
					ontouchstart={onDrawerTouchStart}
					ontouchend={onDrawerTouchEnd}
					aria-expanded={drawerOpen}
				>
					<div class="drawer-pill"></div>
					<span class="text-sm font-medium ml-2 text-foreground">{activeLeftTabLabel}</span>
					<ChevronUp
						size={16}
						class="ml-auto text-muted-foreground transition-transform duration-300 {drawerOpen
							? ''
							: 'rotate-180'}"
					/>
				</button>

				<!-- Inert while closed: the fields are clipped out of view, and tabbing into them
				     would scroll the drawer's insides around behind the handle. -->
				<div class="drawer-content" inert={!drawerOpen}>
					<div class="px-3 pb-6">
						{#if hasLeftPanel}
							{@render panelContent(hasRightPanel ? 'left' : undefined, requestedLeftTabId, false)}
						{/if}
						{#if hasRightPanel}
							<!-- Decorative: the section below names itself with a heading. -->
							<div class="my-4 gap-2 flex items-center" aria-hidden="true">
								<div class="h-px flex-1 bg-border"></div>
								<span class="text-xs font-medium px-1 text-muted-foreground">
									{rightTabs[0]?.label ?? t.moreTab}
								</span>
								<div class="h-px flex-1 bg-border"></div>
							</div>
							{@render panelContent('right', requestedRightTabId, false)}
						{/if}
					</div>
				</div>

				{@render drawerFooter(!drawerOpen)}
			</div>
		{:else}
			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="px-3 pt-3 flex-1 overflow-y-auto">
					{#if hasLeftPanel}
						{@render panelContent(hasRightPanel ? 'left' : undefined, requestedLeftTabId, false)}
					{/if}
					{#if hasRightPanel}
						<div class="my-4 gap-2 flex items-center" aria-hidden="true">
							<div class="h-px flex-1 bg-border"></div>
							<span class="text-xs font-medium px-1 text-muted-foreground">
								{rightTabs[0]?.label ?? t.moreTab}
							</span>
							<div class="h-px flex-1 bg-border"></div>
						</div>
						{@render panelContent('right', requestedRightTabId, false)}
					{/if}
				</div>
				{@render drawerFooter(false)}
			</div>
		{/if}
	{:else if !hasViewer && !isTwoPanelMode && hasLeftPanel !== hasRightPanel}
		<!-- Single centered panel (left-only or right-only), no viewer -->
		<div class="min-h-0 flex h-full flex-1 justify-center">
			<div class="min-h-0 flex h-full w-4/5 flex-col">
				{@render panelContent(
					hasRightPanel ? 'right' : undefined,
					hasRightPanel ? requestedRightTabId : requestedLeftTabId
				)}
			</div>
		</div>
	{:else}
		<div class="min-h-0 flex h-full flex-1">
			<!-- Outside PaneGroup so the strip keeps a fixed width. -->
			{#if leftCollapsed && hasSidebar && hasLeftPanel}
				<CollapsedPanelStrip
					side="left"
					tabs={leftTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => leftPaneRef?.expand()}
					onTabClick={(id) => {
						requestedLeftTabId = id;
						leftPaneRef?.expand();
					}}
				/>
			{/if}

			<Resizable.PaneGroup
				direction="horizontal"
				autoSaveId="selva-layout-{layoutKey}"
				class="min-h-0 flex-1"
			>
				{#if hasLeftPanel}
					<Resizable.Pane
						bind:this={leftPaneRef}
						order={1}
						defaultSize={isTwoPanelMode ? 50 : hasViewer && hasRightPanel ? 22 : 30}
						minSize={15}
						maxSize={45}
						collapsible
						collapsedSize={0}
						onCollapse={() => (leftCollapsed = true)}
						onExpand={() => (leftCollapsed = false)}
						class="ml-1"
					>
						<div
							class="min-h-0 flex h-full flex-col {isViewerFullscreen || leftCollapsed
								? 'hidden'
								: ''}"
						>
							{@render panelContent(hasRightPanel ? 'left' : undefined, requestedLeftTabId)}
						</div>
					</Resizable.Pane>
					<Resizable.Handle
						withHandle
						line={false}
						data-collapsed={leftCollapsed}
						onclick={() => {
							if (leftCollapsed) leftPaneRef?.expand();
						}}
					/>
				{/if}

				{#if hasViewer}
					<Resizable.Pane order={2} minSize={20} class="min-h-0 mx-1 flex flex-col">
						<Viewer
							{meshes}
							bind:isFullscreen={isViewerFullscreen}
							{isSolving}
							{logoUrl}
							{onViewerReady}
							viewerConfig={{
								...viewerConfig,
								backgroundColor: schema?.viewerOptions?.backgroundColor
							}}
						/>
					</Resizable.Pane>
				{/if}

				{#if hasRightPanel}
					<Resizable.Handle
						withHandle
						line={false}
						data-collapsed={rightCollapsed}
						onclick={() => {
							if (rightCollapsed) rightPaneRef?.expand();
						}}
					/>
					<Resizable.Pane
						bind:this={rightPaneRef}
						order={3}
						defaultSize={isTwoPanelMode ? 50 : 25}
						minSize={15}
						maxSize={45}
						collapsible
						collapsedSize={0}
						onCollapse={() => (rightCollapsed = true)}
						onExpand={() => (rightCollapsed = false)}
						class="mr-1"
					>
						<div
							class="min-h-0 flex h-full flex-col {isViewerFullscreen || rightCollapsed
								? 'hidden'
								: ''}"
						>
							{@render panelContent('right', requestedRightTabId, !hasLeftPanel)}
						</div>
					</Resizable.Pane>
				{/if}
			</Resizable.PaneGroup>

			{#if rightCollapsed && hasRightPanel}
				<CollapsedPanelStrip
					side="right"
					tabs={rightTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => rightPaneRef?.expand()}
					onTabClick={(id) => {
						requestedRightTabId = id;
						rightPaneRef?.expand();
					}}
				/>
			{/if}
		</div>
	{/if}

	<SolvingIndicator show={showSolvingIndicator} />
</main>

<!-- The save, load and validation dialogs; the footer's menu opens them. -->
<ParameterPresetManager
	bind:this={presets}
	{schema}
	currentValues={values}
	onLoadValues={handleLoadValues}
	{onSaveState}
	{onListStates}
	labels={presetLabels}
/>

<style>
	.fullscreen-layout {
		position: fixed;
		inset: 0;
		z-index: 9999;
		padding: 0 !important;
	}

	/* When the adjacent pane is collapsed, override paneforge's inline
	   ew-resize cursor — there's nothing to drag from in this state. */
	:global([data-pane-resizer][data-collapsed='true']) {
		cursor: pointer !important;
	}

	.panel-content-wrapper {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.panel-footer {
		flex-shrink: 0;
		padding-top: 0.75rem;
		padding-bottom: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.drawer-container {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		transition: height 0.35s cubic-bezier(0.32, 0.72, 0, 1);
		overflow: hidden;
	}

	.drawer-closed {
		height: 60px;
	}
	/* The pinned footer takes a fixed slice, so a short phone opens the drawer further to leave
	   room for the fields; a tall one keeps it at 60% of the screen. */
	.drawer-open {
		height: max(60svh, min(30rem, 100svh - 10rem));
	}

	.drawer-handle-bar {
		position: relative;
		height: 60px;
		padding: 20px 1rem 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		background: transparent;
		border: none;
		width: 100%;
		flex-shrink: 0;
		-webkit-tap-highlight-color: transparent;
	}

	.drawer-handle-bar:active {
		background: var(--muted);
	}

	.drawer-pill {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		width: 2.5rem;
		height: 4px;
		border-radius: 9999px;
		background: var(--muted-foreground);
		opacity: 0.4;
	}

	.drawer-content {
		flex: 1;
		overflow-y: auto;
		-webkit-overflow-scrolling: touch;
	}

	.drawer-footer {
		flex-shrink: 0;
		padding: 0rem 1rem;
	}

	/* Touch gets 44px targets on the panel's controls; a fine pointer keeps the denser sizes. */
	@media (pointer: coarse) {
		.panel-content-wrapper
			:global(
				:is(
					[data-slot='button'],
					[data-slot='input'],
					[data-slot='select-trigger'],
					[data-slot='input-group']
				)
			),
		.drawer-footer :global([data-slot='button']) {
			min-height: 2.75rem;
		}
		.panel-content-wrapper :global([data-slot='input-group'] > [data-slot='input-group-control']) {
			align-self: stretch;
			height: auto;
		}
	}
</style>
