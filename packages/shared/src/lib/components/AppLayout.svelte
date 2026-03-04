<script lang="ts">
	import type { UISchema, SupportedTypes } from '../types/generated';
	import { ChevronUp } from '@lucide/svelte';
	import Viewer from './Viewer.svelte';
	import CalculateButton from './ui/CalculateButton.svelte';
	import SolvingIndicator from './ui/SolvingIndicator.svelte';
	import StateManager from './StateManager.svelte';
	import TabLayout from './preview/TabLayout.svelte';
	import CollapsedPanelStrip from './CollapsedPanelStrip.svelte';

	// ── Constants ────────────────────────────────────────────────────────────────
	const DEFAULT_WIDTH = 420;
	const COLLAPSE_THRESHOLD = 300;
	const COLLAPSED_WIDTH = 48;

	// ── Props ────────────────────────────────────────────────────────────────────
	interface Props {
		schema: UISchema;
		meshes?: any[];
		isSolving: boolean;
		showSolvingIndicator?: boolean;
		hasPendingChanges?: boolean;
		isViewerFullscreen?: boolean;
		oncalculate?: () => void;
		values: Record<string, unknown>;
		onValueChange: (id: string, val: SupportedTypes) => void | Promise<void>;
		onLoadValues?: () => void | Promise<void>;
		environment?: 'local' | 'compute';
	}

	let {
		schema,
		meshes = [],
		isSolving,
		showSolvingIndicator = false,
		hasPendingChanges = false,
		isViewerFullscreen = $bindable(false),
		oncalculate = () => {},
		values = $bindable({}),
		onValueChange,
		onLoadValues,
		environment
	}: Props = $props();

	// ── Layout flags ─────────────────────────────────────────────────────────────
	const hasViewer = $derived(
		!!(schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote)
	);
	const leftTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position !== 'right') : []
	);
	const rightTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position === 'right') : []
	);
	const hasLeftPanel = $derived(leftTabs.length > 0);
	const hasRightPanel = $derived(rightTabs.length > 0);
	const hasSidebar = $derived(hasViewer || hasRightPanel);
	// Two-panel mode: left + right, no viewer — both panels grow to fill full width
	const isTwoPanelMode = $derived(!hasViewer && hasLeftPanel && hasRightPanel);

	// ── Responsive state ─────────────────────────────────────────────────────────
	let isMobile = $state(false);
	let isTablet = $state(false);
	let drawerOpen = $state(false);

	const restoreWidth = $derived(isTablet ? 280 : DEFAULT_WIDTH);
	const activeLeftTabLabel = $derived(leftTabs[0]?.label ?? 'Parameters');

	$effect(() => {
		const mqMobile = window.matchMedia('(max-width: 639px)');
		const mqTablet = window.matchMedia('(min-width: 640px) and (max-width: 1023px)');

		function update() {
			isMobile = mqMobile.matches;
			isTablet = mqTablet.matches;
			if (mqTablet.matches) {
				leftWidth = 280;
				rightWidth = 280;
			} else if (!mqMobile.matches) {
				leftWidth = DEFAULT_WIDTH;
				rightWidth = DEFAULT_WIDTH;
			}
		}

		update();
		mqMobile.addEventListener('change', update);
		mqTablet.addEventListener('change', update);
		return () => {
			mqMobile.removeEventListener('change', update);
			mqTablet.removeEventListener('change', update);
		};
	});

	// ── Panel resize ─────────────────────────────────────────────────────────────
	let leftWidth = $state(DEFAULT_WIDTH);
	let rightWidth = $state(DEFAULT_WIDTH);
	// Two-panel split ratio: left takes splitRatio of width, right takes (1 - splitRatio)
	let splitRatio = $state(0.5);
	let isDragging = $state(false);
	let requestedLeftTabId = $state<string | null>(null);
	let requestedRightTabId = $state<string | null>(null);

	const leftCollapsed = $derived(leftWidth <= COLLAPSED_WIDTH);
	const rightCollapsed = $derived(rightWidth <= COLLAPSED_WIDTH);

	let _side: 'left' | 'right' | 'middle' | null = null;
	let _startX = 0;
	let _startW = 0;
	let _startRatio = 0;
	let _containerEl: HTMLElement | null = null;

	function clampWidth(raw: number): number {
		const max = window.innerWidth / 4;
		return raw < COLLAPSE_THRESHOLD
			? COLLAPSED_WIDTH
			: Math.min(max, Math.max(COLLAPSE_THRESHOLD, raw));
	}

	function startDrag(side: 'left' | 'right' | 'middle', e: MouseEvent) {
		_side = side;
		_startX = e.clientX;
		_startW = side === 'left' ? leftWidth : side === 'right' ? rightWidth : leftWidth;
		_startRatio = splitRatio;
		_containerEl = (e.currentTarget as HTMLElement).closest('[data-layout-root]') as HTMLElement;
		isDragging = true;
		window.addEventListener('mousemove', onDrag);
		window.addEventListener('mouseup', stopDrag);
		e.preventDefault();
	}

	function onDrag(e: MouseEvent) {
		if (!_side) return;
		const delta = e.clientX - _startX;

		if (_side === 'middle') {
			const containerW = _containerEl?.clientWidth ?? window.innerWidth;
			splitRatio = Math.min(0.85, Math.max(0.15, _startRatio + delta / containerW));
		} else {
			const raw = _side === 'left' ? _startW + delta : _startW - delta;
			if (_side === 'left') leftWidth = clampWidth(raw);
			else rightWidth = clampWidth(raw);
		}
	}

	function stopDrag() {
		_side = null;
		_containerEl = null;
		isDragging = false;
		window.removeEventListener('mousemove', onDrag);
		window.removeEventListener('mouseup', stopDrag);
	}

	async function handleLoadValues(loadedValues: Record<string, unknown>) {
		Object.assign(values, loadedValues);
		await onLoadValues?.();
	}

	// ── Swipe gesture (mobile drawer) ────────────────────────────────────────────
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

<!-- ── Snippets ───────────────────────────────────────────────────────────────── -->

{#snippet dragHandle(side: 'left' | 'right' | 'middle', label: string)}
	<div
		class="sm:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
		style="width: 6px"
		onmousedown={(e) => startDrag(side, e)}
		role="button"
		tabindex="0"
		aria-label={label}
	>
		<div class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"></div>
	</div>
{/snippet}

{#snippet panelContent(
	panelFilter: 'left' | 'right' | undefined,
	requestedTabId: string | null,
	showStateManager = true,
	showCalculateButton = true
)}
	{#if schema.layout.type === 'tabbed'}
		<TabLayout {schema} bind:values {onValueChange} {environment} {panelFilter} {requestedTabId} />
	{/if}
	{#if showStateManager}
		<div class="mt-6">
			<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
		</div>
	{/if}
	{#if !isMobile && showCalculateButton && schema.instanceSolve === false}
		<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
	{/if}
{/snippet}

<!-- ── Root container ─────────────────────────────────────────────────────────── -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	data-layout-root
	class="min-h-0 sm:flex-row flex flex-1 flex-col overflow-hidden"
	class:fullscreen-layout={isViewerFullscreen}
	class:relative={isMobile}
	class:cursor-ew-resize={isDragging}
>
	{#if isMobile}
		<!-- ═══ MOBILE LAYOUT ══════════════════════════════════════════════════════ -->
		{#if hasViewer}
			<div class="min-h-0 flex flex-1 flex-col">
				<Viewer
					{schema}
					{meshes}
					bind:isFullscreen={isViewerFullscreen}
					{isSolving}
					isBlurred={drawerOpen}
					{drawerOpen}
				/>
			</div>

			<div
				class="drawer-container"
				class:drawer-open={drawerOpen}
				class:drawer-closed={!drawerOpen}
				style="z-index: 40;"
			>
				<button
					class="drawer-handle-bar"
					onclick={() => (drawerOpen = !drawerOpen)}
					ontouchstart={onDrawerTouchStart}
					ontouchend={onDrawerTouchEnd}
					aria-label={drawerOpen ? 'Collapse panel' : 'Expand panel'}
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

				<div class="drawer-content">
					<div class="px-3 pb-6">
						{#if hasLeftPanel}
							{@render panelContent(
								hasRightPanel ? 'left' : undefined,
								requestedLeftTabId,
								!hasRightPanel,
								false
							)}
						{/if}
						{#if hasRightPanel}
							<div class="my-4 gap-2 flex items-center">
								<div class="h-px flex-1 bg-border"></div>
								<span class="text-xs font-medium px-1 text-muted-foreground">
									{rightTabs[0]?.label ?? 'More'}
								</span>
								<div class="h-px flex-1 bg-border"></div>
							</div>
							{@render panelContent('right', requestedRightTabId, true, false)}
						{/if}
					</div>
				</div>

				{#if schema.instanceSolve === false}
					<div class="drawer-footer">
						<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex flex-1 flex-col overflow-hidden">
				<div class="px-3 pt-3 flex-1 overflow-y-auto">
					{#if hasLeftPanel}
						{@render panelContent(
							hasRightPanel ? 'left' : undefined,
							requestedLeftTabId,
							!hasRightPanel,
							false
						)}
					{/if}
					{#if hasRightPanel}
						<div class="my-4 gap-2 flex items-center">
							<div class="h-px flex-1 bg-border"></div>
							<span class="text-xs font-medium px-1 text-muted-foreground">
								{rightTabs[0]?.label ?? 'More'}
							</span>
							<div class="h-px flex-1 bg-border"></div>
						</div>
						{@render panelContent('right', requestedRightTabId, true, false)}
					{/if}
				</div>
				{#if schema.instanceSolve === false}
					<div class="drawer-footer">
						<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- ═══ DESKTOP LAYOUT ═════════════════════════════════════════════════════ -->

		<!-- Left panel -->
		{#if hasLeftPanel || !hasSidebar}
			{#if leftCollapsed && hasSidebar}
				<CollapsedPanelStrip
					side="left"
					tabs={leftTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => (leftWidth = restoreWidth)}
					onTabClick={(id) => {
						requestedLeftTabId = id;
						leftWidth = restoreWidth;
					}}
				/>
			{:else}
				<div
					class="px-3 min-h-0 overflow-y-auto"
					class:hidden={isViewerFullscreen}
					class:shrink-0={!isTwoPanelMode}
					class:lg:mx-auto={!hasSidebar && !hasRightPanel}
					class:lg:max-w-6xl={!hasSidebar && !hasRightPanel}
					class:w-full={!hasSidebar && !hasRightPanel}
					class:left-panel-scroll={hasSidebar || hasRightPanel || isTwoPanelMode}
					style={isTwoPanelMode
						? `flex: ${splitRatio} 1 0%; min-width: 0;`
						: hasSidebar || hasRightPanel
							? `width: ${leftWidth}px; max-width: 100%;`
							: undefined}
				>
					<div class="left-panel-content">
						{@render panelContent(hasRightPanel ? 'left' : undefined, requestedLeftTabId)}
					</div>
				</div>
			{/if}

			{#if !isTwoPanelMode && hasSidebar && hasLeftPanel}
				{@render dragHandle('left', 'Resize left panel')}
			{/if}
		{/if}

		<!-- Viewer -->
		{#if hasViewer}
			<div
				class="min-h-0 flex flex-1 flex-col"
				class:pl-3={!hasLeftPanel && !leftCollapsed}
				class:pr-3={!hasRightPanel}
			>
				<Viewer {schema} {meshes} bind:isFullscreen={isViewerFullscreen} {isSolving} />
			</div>
		{/if}

		<!-- Two-panel drag handle: sits between left and right flex panels -->
		{#if isTwoPanelMode}
			{@render dragHandle('middle', 'Resize panels')}
		{/if}

		<!-- Right panel -->
		{#if hasRightPanel}
			{#if hasViewer || hasLeftPanel}
				{@render dragHandle('right', 'Resize right panel')}
			{/if}

			{#if rightCollapsed}
				<CollapsedPanelStrip
					side="right"
					tabs={rightTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => (rightWidth = restoreWidth)}
					onTabClick={(id) => {
						requestedRightTabId = id;
						rightWidth = restoreWidth;
					}}
				/>
			{:else}
				<div
					class="px-3 min-h-0 overflow-y-auto"
					class:hidden={isViewerFullscreen}
					class:shrink-0={!isTwoPanelMode}
					style={isTwoPanelMode
						? `flex: ${1 - splitRatio} 1 0%; min-width: 0;`
						: `width: ${rightWidth}px; max-width: 100%;`}
				>
					{@render panelContent('right', requestedRightTabId, !hasLeftPanel, !hasLeftPanel)}
				</div>
			{/if}
		{/if}
	{/if}
</div>

<SolvingIndicator show={showSolvingIndicator} />

<style>
	.fullscreen-layout {
		position: fixed;
		inset: 0;
		z-index: 9999;
		padding: 0 !important;
	}

	.drawer-container {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 100;
		display: flex;
		flex-direction: column;
		border-radius: 1rem 1rem 0 0;
		background: var(--background);
		border-top: 1px solid var(--border);
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.12);
		transition: height 0.35s cubic-bezier(0.32, 0.72, 0, 1);
		overflow: hidden;
	}

	.drawer-closed {
		height: 60px;
	}
	.drawer-open {
		height: 60svh;
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
		border-top: 1px solid var(--border);
	}

	.left-panel-scroll {
		direction: rtl;
	}

	.left-panel-content {
		direction: ltr;
	}
</style>
