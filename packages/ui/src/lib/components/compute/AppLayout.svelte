<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { UISchema, SupportedTypes, ParameterPreset } from '@selvajs/schemas';
	import type { LiveSolveState, SolveSettlement } from '@selvajs/solve/client';
	import type { ActionButton } from '../../types/actionButton';
	import type { PresetLabels } from '../../types/presetLabels';
	import { ChevronLeft, ChevronUp, Download, Ellipsis, Upload } from '@lucide/svelte';
	import type { ThreeViewer } from '@selvajs/visualization/render';
	import Viewer, { type ViewerConfig } from '../viewer/Viewer.svelte';
	import CalculateButton from '../primitives/CalculateButton.svelte';
	import SolvingIndicator from '../primitives/SolvingIndicator.svelte';
	import TabLayout from '../preview/TabLayout.svelte';
	import CollapsedPanelStrip from './CollapsedPanelStrip.svelte';
	import * as Resizable from '#lib/components/primitives/resizable/index.js';
	import * as DropdownMenu from '#lib/components/primitives/dropdown-menu/index.js';
	import { Button } from '#lib';
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
		/**
		 * Whether to draw the 3D viewer. Each host reads its own switch: the plugin's preview
		 * `viewerOptions.enableLocal`, a Rhino.Compute host `viewerOptions.enableRemote`.
		 */
		showViewer: boolean;
		meshes?: any[];
		isSolving: boolean;
		/**
		 * `createSolvingIndicator(...).show`, not `isSolving`: grows the action row's solve status,
		 * which would otherwise flash on every sub-second solve.
		 */
		showSolvingIndicator?: boolean;
		/** `createSolvingIndicator(...).slow`: the solve status grows into a card with progress. */
		solveIsSlow?: boolean;
		/** The session's live channel: step, count and bar for that card. */
		live?: LiveSolveState;
		/** Abort in that card. The host's `SolveMessages` should then take `progressShownByHost`. */
		onabort?: () => void;
		/** As passed to `createSolvingIndicator`. */
		freezesDuringSolve?: boolean;
		/** @deprecated Ignored: the solving status always sits in the action row. */
		solvingIndicatorPlacement?: 'floating' | 'inline';
		/** Rendered above the action row, for a host that keeps the solve's messages in the flow. */
		solveMessages?: Snippet;
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
		showViewer: hasViewer,
		meshes = [],
		isSolving,
		showSolvingIndicator = false,
		solveIsSlow = false,
		live,
		onabort,
		freezesDuringSolve = false,
		solveMessages,
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
	// Half keeps the model visible above the fields so a change can be watched as it solves;
	// full is for long forms.
	type DrawerState = 'closed' | 'half' | 'full';
	let drawer = $state<DrawerState>('closed');
	const DRAWER_STATES: DrawerState[] = ['closed', 'half', 'full'];

	// With several tabs the first tab's name would mislabel whichever one is showing.
	const drawerLabel = $derived(leftTabs.length === 1 ? leftTabs[0].label : t.parametersTab);

	// A phone on its side is wide enough for the desktop columns but far too short for them, and a
	// bottom drawer would leave the model a strip. It gets the phone layout with the drawer moved to
	// the right edge instead.
	let sideSheet = $state(false);

	$effect(() => {
		const mqNarrow = window.matchMedia('(max-width: 639px)');
		const mqPhoneLandscape = window.matchMedia(
			'(pointer: coarse) and (orientation: landscape) and (max-height: 500px)'
		);
		function update() {
			sideSheet = mqPhoneLandscape.matches;
			isMobile = mqNarrow.matches || sideSheet;
		}
		update();
		mqNarrow.addEventListener('change', update);
		mqPhoneLandscape.addEventListener('change', update);
		return () => {
			mqNarrow.removeEventListener('change', update);
			mqPhoneLandscape.removeEventListener('change', update);
		};
	});

	// Without a viewer there's nothing to sit beside, so a narrow host (a docked Rhino panel) gets
	// the phone's single edge-to-edge column instead of a card floating in its own margins.
	const STACK_BELOW_WIDTH = 900;
	let rootWidth = $state(0);
	const stacked = $derived(
		isMobile || (!hasViewer && rootWidth > 0 && rootWidth < STACK_BELOW_WIDTH)
	);

	let leftCollapsed = $state(false);
	let rightCollapsed = $state(false);
	let leftPaneRef = $state<{ expand: () => void } | null>(null);
	let rightPaneRef = $state<{ expand: () => void } | null>(null);
	let requestedLeftTabId = $state<string | null>(null);
	let requestedRightTabId = $state<string | null>(null);

	const leftDefaultSize = $derived(isTwoPanelMode ? 50 : hasViewer && hasRightPanel ? 22 : 30);
	const rightDefaultSize = $derived(isTwoPanelMode ? 50 : 25);
	// Paneforge renders a pane without a defaultSize as `flex-grow: 1` until it mounts, beside the
	// side panes' 22–30: the viewer rendered a sliver, then jumped to its share (CLS ~0.4).
	const viewerDefaultSize = $derived(
		100 - (hasLeftPanel ? leftDefaultSize : 0) - (hasRightPanel ? rightDefaultSize : 0)
	);

	const layoutKey = $derived(
		`${hasLeftPanel ? 'L' : ''}${hasViewer ? 'V' : ''}${hasRightPanel ? 'R' : ''}`
	);

	async function handleLoadValues(loadedValues: Record<string, unknown>) {
		Object.assign(values, loadedValues);
		await onLoadValues?.(loadedValues);
	}

	let touchStart = { x: 0, y: 0 };

	// The side sheet beside the model has no half state: it is open or closed.
	function stepDrawer(by: number) {
		if (sideSheet) {
			drawer = by > 0 ? 'full' : 'closed';
			return;
		}
		const index = DRAWER_STATES.indexOf(drawer) + by;
		drawer = DRAWER_STATES[Math.max(0, Math.min(DRAWER_STATES.length - 1, index))];
	}

	function onDrawerTouchStart(e: TouchEvent) {
		touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
	}

	// Toward the open side opens: up for the bottom drawer, left for the side sheet.
	function onDrawerTouchEnd(e: TouchEvent) {
		const delta = sideSheet
			? e.changedTouches[0].clientX - touchStart.x
			: e.changedTouches[0].clientY - touchStart.y;
		const SWIPE_THRESHOLD = 40;
		if (Math.abs(delta) > SWIPE_THRESHOLD) {
			// Suppresses the click a short swipe can still end in, which would step the drawer twice.
			e.preventDefault();
			stepDrawer(delta < 0 ? 1 : -1);
		}
	}

	// A tap walks closed → half → full → closed; the side sheet just toggles.
	function onDrawerHandleClick() {
		if (sideSheet) drawer = drawer === 'closed' ? 'full' : 'closed';
		else drawer = drawer === 'full' ? 'closed' : DRAWER_STATES[DRAWER_STATES.indexOf(drawer) + 1];
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
	<!-- No wrapper: it would always render (the messages' live region is never empty) and pick up
	     the drawer footer's row padding, leaving a gap above Calculate with nothing in it. -->
	{@render solveMessages?.()}
	{#if schema.instanceSolve === false}
		<CalculateButton
			{hasPendingChanges}
			{hasNeverSolved}
			{isSolving}
			{oncalculate}
			trailing={hasMenu ? actionsMenu : undefined}
		/>
	{:else}
		<div class="mt-3 pb-3 pt-2 px-2 gap-2 flex items-center border-t border-border">
			<SolvingIndicator
				{isSolving}
				show={showSolvingIndicator}
				slow={solveIsSlow}
				{live}
				{onabort}
				{freezesDuringSolve}
			/>
			{#if hasMenu}
				{@render actionsMenu()}
			{/if}
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
			<TabLayout {schema} {values} {onValueChange} {panelFilter} {requestedTabId} bare={stacked} />
		{/if}
		{#if hostsFooter && !stacked}
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
	class="min-h-0 flex flex-1 flex-col overflow-hidden {stacked
		? ''
		: `sm:flex-row sm:py-2 ${leftCollapsed ? 'sm:pl-0' : 'sm:pl-2'} ${rightCollapsed ? 'sm:pr-0' : 'sm:pr-2'}`}"
	class:fullscreen-layout={isViewerFullscreen}
	class:relative={isMobile}
	class:mobile-root={stacked}
	class:side-sheet={isMobile && sideSheet}
	bind:clientWidth={rootWidth}
>
	{#if stacked}
		{#if isMobile && hasViewer}
			<!-- Ends above the drawer rather than behind it, so the model stays centred in what is
			     visible. It jumps straight to its new size: animating it would resize the canvas,
			     and its render targets, on every frame of the drawer's slide. -->
			<div class="viewer-region" class:viewer-region-raised={drawer !== 'closed'}>
				<Viewer
					{meshes}
					bind:isFullscreen={isViewerFullscreen}
					drawerOpen={!sideSheet && drawer === 'full'}
					{logoUrl}
					{onViewerReady}
					viewerConfig={{
						...viewerConfig,
						backgroundColor: schema?.viewerOptions?.backgroundColor ?? viewerConfig.backgroundColor,
						look: schema?.viewerOptions?.look ?? viewerConfig.look,
						showSceneManager: false
					}}
				/>
			</div>

			<div
				class="drawer-container z-40 bg-background shadow-sheet drawer-{drawer} {sideSheet
					? 'rounded-l-xl border-l'
					: 'rounded-t-xl border-t'}"
			>
				<!-- Named by its visible label; aria-expanded carries the open/closed state. -->
				<button
					class="drawer-handle-bar touch-none"
					onclick={onDrawerHandleClick}
					ontouchstart={onDrawerTouchStart}
					ontouchend={onDrawerTouchEnd}
					aria-expanded={drawer !== 'closed'}
				>
					<div class="drawer-pill"></div>
					<span class="drawer-label text-sm font-medium text-foreground">{drawerLabel}</span>
					{#if sideSheet}
						<ChevronLeft
							size={16}
							class="text-muted-foreground transition-transform duration-300 {drawer !== 'closed'
								? 'rotate-180'
								: ''}"
						/>
					{:else}
						<ChevronUp
							size={16}
							class="ml-auto text-muted-foreground transition-transform duration-300 {drawer ===
							'full'
								? 'rotate-180'
								: ''}"
						/>
					{/if}
				</button>

				<div class="drawer-body">
					<!-- Inert while closed: the fields are clipped out of view, and tabbing into them
				     would scroll the drawer's insides around behind the handle. -->
					<div class="drawer-content" inert={drawer === 'closed'}>
						<div class="px-2 pb-4">
							{#if hasLeftPanel}
								{@render panelContent(
									hasRightPanel ? 'left' : undefined,
									requestedLeftTabId,
									false
								)}
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

					{@render drawerFooter(drawer === 'closed')}
				</div>
			</div>
		{:else}
			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="px-3 pt-3 sm:px-5 flex-1 overflow-y-auto">
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
		<div class="min-h-0 p-1 flex h-full flex-1 justify-center">
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
				class="min-h-0 m-1 flex-1"
			>
				{#if hasLeftPanel}
					<Resizable.Pane
						bind:this={leftPaneRef}
						order={1}
						defaultSize={leftDefaultSize}
						minSize={15}
						maxSize={45}
						collapsible
						collapsedSize={0}
						onCollapse={() => (leftCollapsed = true)}
						onExpand={() => (leftCollapsed = false)}
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
						class="translate-x-1.5 z-20"
						data-collapsed={leftCollapsed}
						onclick={() => {
							if (leftCollapsed) leftPaneRef?.expand();
						}}
					/>
				{/if}

				{#if hasViewer}
					<Resizable.Pane
						order={2}
						defaultSize={viewerDefaultSize}
						minSize={20}
						class="min-h-0 flex flex-col"
					>
						<Viewer
							{meshes}
							bind:isFullscreen={isViewerFullscreen}
							{logoUrl}
							{onViewerReady}
							viewerConfig={{
								...viewerConfig,
								backgroundColor:
									schema?.viewerOptions?.backgroundColor ?? viewerConfig.backgroundColor,
								look: schema?.viewerOptions?.look ?? viewerConfig.look
							}}
						/>
					</Resizable.Pane>
				{/if}

				{#if hasRightPanel}
					{#if hasViewer || !hasLeftPanel}
						<Resizable.Handle
							withHandle
							line={false}
							class="-translate-x-1.5 z-20"
							data-collapsed={rightCollapsed}
							onclick={() => {
								if (rightCollapsed) rightPaneRef?.expand();
							}}
						/>
					{/if}
					<Resizable.Pane
						bind:this={rightPaneRef}
						order={3}
						defaultSize={rightDefaultSize}
						minSize={15}
						maxSize={45}
						collapsible
						collapsedSize={0}
						onCollapse={() => (rightCollapsed = true)}
						onExpand={() => (rightCollapsed = false)}
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

	.mobile-root {
		--drawer-closed-h: 60px;
		--drawer-half-h: 60%;
	}

	/* On a phone the panels stack in one scroller. Held at the scroller's height, a long left
	   panel would spill over the right panel below it. */
	.mobile-root .panel-content-wrapper {
		height: auto;
	}

	.viewer-region {
		position: absolute;
		inset: 0 0 var(--drawer-closed-h) 0;
		display: flex;
		flex-direction: column;
	}

	.viewer-region-raised {
		bottom: var(--drawer-half-h);
	}

	/* The viewer's own minimum height is for a page that scrolls; here the region sets it, and
	   anything taller would run under the drawer and take the viewer's dock with it. */
	.viewer-region > :global(*) {
		min-height: 0;
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
		height: var(--drawer-closed-h);
	}
	.drawer-half {
		height: var(--drawer-half-h);
	}
	/* Leaves a strip of the model showing, so the sheet still reads as sitting over the viewer. */
	.drawer-full {
		height: calc(100% - 3rem);
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

	.drawer-body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.drawer-label {
		margin-left: 0.5rem;
	}

	/* Phone on its side: the drawer becomes a sheet on the right, its handle a strip down its edge. */
	.side-sheet {
		--sheet-closed-w: 3.25rem;
		/* vw, not %: the drawer body resolves this against the sheet, not the layout. */
		--sheet-open-w: min(22rem, 55vw);
	}

	.side-sheet .viewer-region {
		inset: 0 var(--sheet-closed-w) 0 0;
	}

	.side-sheet .viewer-region-raised {
		right: var(--sheet-open-w);
	}

	.side-sheet .drawer-container {
		top: 0;
		left: auto;
		height: auto;
		flex-direction: row;
		transition: width 0.35s cubic-bezier(0.32, 0.72, 0, 1);
	}

	.side-sheet .drawer-closed {
		width: var(--sheet-closed-w);
	}

	.side-sheet .drawer-half,
	.side-sheet .drawer-full {
		width: var(--sheet-open-w);
	}

	.side-sheet .drawer-handle-bar {
		width: var(--sheet-closed-w);
		height: auto;
		padding: 0 0 0 0.75rem;
		flex-direction: column;
		justify-content: center;
		gap: 0.75rem;
	}

	.side-sheet .drawer-pill {
		top: 50%;
		left: 8px;
		transform: translateY(-50%);
		width: 4px;
		height: 2.5rem;
	}

	.side-sheet .drawer-label {
		margin-left: 0;
		writing-mode: vertical-rl;
		transform: rotate(180deg);
	}

	/* Holds its open width while the sheet slides, so the fields don't reflow on every frame. */
	.side-sheet .drawer-body {
		min-width: calc(var(--sheet-open-w) - var(--sheet-closed-w));
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

	/* The sheet's top edge already separates it from the model; the desktop footer's extra
	   spacing only takes rows from the fields. */
	.drawer-footer :global(> div) {
		margin-top: 0;
		padding-block: 0.5rem;
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
