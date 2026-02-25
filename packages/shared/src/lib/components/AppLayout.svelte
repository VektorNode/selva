<script lang="ts">
	import type { UISchema, SupportedTypes } from '../types/generated';
	import Viewer from './Viewer.svelte';
	import CalculateButton from './ui/CalculateButton.svelte';
	import SolvingIndicator from './ui/SolvingIndicator.svelte';
	import StateManager from './StateManager.svelte';
	import TabLayout from './preview/TabLayout.svelte';
	import PanelDragHandle from './PanelDragHandle.svelte';
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
		const next = raw < COLLAPSE_THRESHOLD ? COLLAPSED_WIDTH : Math.min(maxWidth, Math.max(COLLAPSE_THRESHOLD, raw));
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
	class="pt-6 min-h-0 gap-4 lg:gap-0 lg:flex-row flex flex-1 flex-col overflow-hidden {isViewerFullscreen
		? 'fullscreen-layout'
		: ''}"
	class:cursor-ew-resize={isDragging}
>
	<!-- ── Left panel ──────────────────────────────────────────────────────────── -->
	{#if hasLeftTabs || !hasSidebar}
		{#if leftCollapsed && hasSidebar}
			<CollapsedPanelStrip
				side="left"
				tabs={leftTabs}
				collapsedWidth={COLLAPSED_WIDTH}
				onExpand={() => (leftWidth = DEFAULT_WIDTH)}
				onTabClick={(id) => {
					requestedLeftTabId = id;
					leftWidth = DEFAULT_WIDTH;
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

		{#if hasSidebar}
			<PanelDragHandle
				onDragStart={(e) => startDrag('left', e)}
				ariaLabel="Resize left panel"
			/>
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
		<PanelDragHandle
			onDragStart={(e) => startDrag('right', e)}
			ariaLabel="Resize right panel"
		/>

		{#if rightCollapsed}
			<CollapsedPanelStrip
				side="right"
				tabs={rightTabs}
				collapsedWidth={COLLAPSED_WIDTH}
				onExpand={() => (rightWidth = DEFAULT_WIDTH)}
				onTabClick={(id) => {
					requestedRightTabId = id;
					rightWidth = DEFAULT_WIDTH;
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
</div>

<!-- Only shown in instant mode — manual mode uses CalculateButton for feedback -->
<SolvingIndicator show={showSolvingIndicator} />

<style>
	.fullscreen-layout {
		position: fixed;
		inset: 0;
		z-index: 9999;
		padding: 0 !important;
		background: white;
	}
</style>
