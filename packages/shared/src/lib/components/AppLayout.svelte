<script lang="ts">
	import type { UISchema, SupportedTypes } from '../types/generated';
	import { ChevronUp } from '@lucide/svelte';
	import Viewer from './Viewer.svelte';
	import CalculateButton from './ui/CalculateButton.svelte';
	import SolvingIndicator from './ui/SolvingIndicator.svelte';
	import StateManager from './StateManager.svelte';
	import TabLayout from './preview/TabLayout.svelte';
	import CollapsedPanelStrip from './CollapsedPanelStrip.svelte';

	interface Props {
		schema: UISchema;
		meshes?: any[];
		/** Raw solving state — drives viewer blur and CalculateButton spinner */
		isSolving: boolean;
		/** Debounced/gated value — drives the floating SolvingIndicator toast */
		showSolvingIndicator?: boolean;
		hasPendingChanges?: boolean;
		isViewerFullscreen?: boolean;
		oncalculate?: () => void;
		/** Current parameter values — two-way bound */
		values: Record<string, unknown>;
		onValueChange: (id: string, val: SupportedTypes) => void | Promise<void>;
		/** Called after values are loaded from StateManager — use for triggering a solve */
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

	// Layout flags derived entirely from schema
	const hasViewer = $derived(
		!!(schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote)
	);
	const hasRightPanel = $derived(
		schema.layout.type === 'tabbed' && schema.layout.tabs.some((t) => t.position === 'right')
	);
	const hasLeftTabs = $derived(
		schema.layout.type === 'tabbed' && schema.layout.tabs.some((t) => t.position !== 'right')
	);
	const hasSidebar = $derived(hasViewer || hasRightPanel);

	const leftTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position !== 'right') : []
	);
	const rightTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position === 'right') : []
	);

	// ── Panel resize ────────────────────────────────────────────────────────────
	const DEFAULT_WIDTH = 380;
	const COLLAPSE_THRESHOLD = 300;
	const COLLAPSED_WIDTH = 48;

	let leftWidth = $state(DEFAULT_WIDTH);
	let rightWidth = $state(DEFAULT_WIDTH);
	let isDragging = $state(false);
	let requestedLeftTabId = $state<string | null>(null);
	let requestedRightTabId = $state<string | null>(null);

	const leftCollapsed = $derived(leftWidth <= COLLAPSED_WIDTH);
	const rightCollapsed = $derived(rightWidth <= COLLAPSED_WIDTH);

	// ── Breakpoint detection ─────────────────────────────────────────────────────────
	let isMobile = $state(false); // < 640px
	let isTablet = $state(false); // 640–1023px

	// ── Mobile drawer ────────────────────────────────────────────────────────────────
	let drawerOpen = $state(false);

	// Restore width is breakpoint-sensitive
	const RESTORE_WIDTH = $derived(isTablet ? 280 : DEFAULT_WIDTH);

	// Label shown in drawer handle bar
	const activeLeftTabLabel = $derived(
		leftTabs.length > 0 ? (leftTabs[0].label ?? 'Parameters') : 'Parameters'
	);

	// Breakpoint watcher — runs on mount, cleans up on destroy
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

	let _side: 'left' | 'right' | null = null;
	let _startX = 0;
	let _startW = 0;

	function startDrag(side: 'left' | 'right', e: MouseEvent) {
		_side = side;
		_startX = e.clientX;
		_startW = side === 'left' ? leftWidth : rightWidth;
		isDragging = true;
		window.addEventListener('mousemove', onDrag);
		window.addEventListener('mouseup', stopDrag);
		e.preventDefault();
	}

	function onDrag(e: MouseEvent) {
		if (!_side) return;
		const maxWidth = window.innerWidth / 4;
		const delta = e.clientX - _startX;
		const raw = _side === 'left' ? _startW + delta : _startW - delta;
		const next =
			raw < COLLAPSE_THRESHOLD
				? COLLAPSED_WIDTH
				: Math.min(maxWidth, Math.max(COLLAPSE_THRESHOLD, raw));
		if (_side === 'left') leftWidth = next;
		else rightWidth = next;
	}

	function stopDrag() {
		_side = null;
		isDragging = false;
		window.removeEventListener('mousemove', onDrag);
		window.removeEventListener('mouseup', stopDrag);
	}

	async function handleLoadValues(loadedValues: Record<string, unknown>) {
		Object.assign(values, loadedValues);
		await onLoadValues?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="min-h-0 sm:flex-row flex flex-1 flex-col overflow-hidden {isViewerFullscreen
		? 'fullscreen-layout'
		: ''}"
	class:relative={isMobile}
	class:cursor-ew-resize={isDragging}
>
	{#if isMobile}
		<!-- ═══════════════════════════════════════════════════════════════════════════════════
		     MOBILE LAYOUT: Viewer first, bottom drawer for inputs
		     ═════════════════════════════════════════════════════════════════════════════════ -->

		{#if hasViewer}
			<!-- Viewer fills full height -->
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

			<!-- Bottom drawer -->
			<div
				class="drawer-container {drawerOpen ? 'drawer-open' : 'drawer-closed'}"
				style="z-index: 40;"
			>
				<!-- Drawer handle bar -->
				<button
					class="drawer-handle-bar"
					onclick={() => (drawerOpen = !drawerOpen)}
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

				<!-- Drawer scrollable content -->
				<div class="drawer-content">
					<div class="px-3 pb-6">
						{#if schema.layout.type === 'tabbed' && hasLeftTabs}
							<TabLayout
								{schema}
								bind:values
								{onValueChange}
								{environment}
								panelFilter={hasRightPanel ? 'left' : undefined}
								requestedTabId={requestedLeftTabId}
							/>
						{/if}
						{#if hasRightPanel}
							<TabLayout
								{schema}
								bind:values
								{onValueChange}
								{environment}
								panelFilter="right"
								requestedTabId={requestedRightTabId}
							/>
						{/if}
						<div class="mt-6">
							<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
						</div>
						{#if schema.instanceSolve === false}
							<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
						{/if}
					</div>
				</div>
			</div>
		{:else}
			<!-- No viewer: full-height scrollable column, no drawer -->
			<div class="px-3 flex-1 overflow-y-auto {!hasSidebar ? 'lg:mx-auto lg:max-w-6xl' : ''}">
				{#if schema.layout.type === 'tabbed' && hasLeftTabs}
					<TabLayout
						{schema}
						bind:values
						{onValueChange}
						{environment}
						panelFilter={hasRightPanel ? 'left' : undefined}
						requestedTabId={requestedLeftTabId}
					/>
				{/if}
				<div class="mt-6">
					<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
				</div>
				{#if schema.instanceSolve === false}
					<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
				{/if}
			</div>
		{/if}
	{:else}
		{#if hasLeftTabs || !hasSidebar}
			{#if leftCollapsed && hasSidebar}
				<CollapsedPanelStrip
					side="left"
					tabs={leftTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => (leftWidth = RESTORE_WIDTH)}
					onTabClick={(id) => {
						requestedLeftTabId = id;
						leftWidth = RESTORE_WIDTH;
					}}
				/>
			{:else}
				<div
					class="px-3 min-h-0 w-full shrink-0 overflow-y-auto {isViewerFullscreen
						? 'hidden'
						: ''} {!hasSidebar ? 'lg:mx-auto lg:max-w-6xl' : ''}"
					style={hasSidebar ? `width: ${leftWidth}px; max-width: 100%;` : undefined}
				>
					{#if schema.layout.type === 'tabbed' && hasLeftTabs}
						<TabLayout
							{schema}
							bind:values
							{onValueChange}
							{environment}
							panelFilter={hasRightPanel ? 'left' : undefined}
							requestedTabId={requestedLeftTabId}
						/>
					{/if}
					<div class="mt-6">
						<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
					</div>
					{#if schema.instanceSolve === false}
						<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
					{/if}
				</div>
			{/if}

			<!-- Inline drag handle, visible at sm+ breakpoints -->
			{#if hasSidebar}
				<div
					class="sm:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
					style="width: 6px"
					onmousedown={(e) => startDrag('left', e)}
					role="button"
					tabindex="0"
					aria-label="Resize left panel"
				>
					<div
						class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"
					></div>
				</div>
			{/if}
		{/if}

		<!-- ── Viewer ──────────────────────────────────────────────────────────────── -->
		{#if hasViewer}
			<div
				class="min-h-0 flex flex-1 flex-col"
				class:pl-3={!hasLeftTabs && !leftCollapsed}
				class:pr-3={!hasRightPanel}
			>
				<Viewer {schema} {meshes} bind:isFullscreen={isViewerFullscreen} {isSolving} />
			</div>
		{/if}

		<!-- ── Right panel ────────────────────────────────────────────────────────── -->
		{#if hasRightPanel}
			<!-- Inline drag handle, visible at sm+ breakpoints -->
			<div
				class="sm:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
				style="width: 6px"
				onmousedown={(e) => startDrag('right', e)}
				role="button"
				tabindex="0"
				aria-label="Resize right panel"
			>
				<div
					class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"
				></div>
			</div>

			{#if rightCollapsed}
				<CollapsedPanelStrip
					side="right"
					tabs={rightTabs}
					collapsedWidth={COLLAPSED_WIDTH}
					onExpand={() => (rightWidth = RESTORE_WIDTH)}
					onTabClick={(id) => {
						requestedRightTabId = id;
						rightWidth = RESTORE_WIDTH;
					}}
				/>
			{:else}
				<div
					class="px-3 min-h-0 w-full shrink-0 overflow-y-auto {isViewerFullscreen ? 'hidden' : ''}"
					style="width: {rightWidth}px; max-width: 100%;"
				>
					<TabLayout
						{schema}
						bind:values
						{onValueChange}
						{environment}
						panelFilter="right"
						requestedTabId={requestedRightTabId}
					/>
					{#if !hasLeftTabs}
						<div class="mt-6">
							<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
						</div>
						{#if schema.instanceSolve === false}
							<CalculateButton {hasPendingChanges} {isSolving} {oncalculate} />
						{/if}
					{/if}
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
		background: white;
	}

	/* Mobile bottom drawer */

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
</style>
