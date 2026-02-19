<script lang="ts">
	import type { UISchema, SupportedTypes } from '../types/generated';
	import Viewer from './Viewer.svelte';
	import CalculateButton from './ui/CalculateButton.svelte';
	import SolvingIndicator from './ui/SolvingIndicator.svelte';
	import StateManager from './StateManager.svelte';
	import TabLayout from './preview/TabLayout.svelte';
	import { ChevronRight, ChevronLeft } from '@lucide/svelte';

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

	// Tab lists used for compact collapsed strip
	const leftTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position !== 'right') : []
	);
	const rightTabs = $derived(
		schema.layout.type === 'tabbed' ? schema.layout.tabs.filter((t) => t.position === 'right') : []
	);

	// ── Panel resize ────────────────────────────────────────────────────────────
	const DEFAULT_WIDTH = 380;
	const COLLAPSE_THRESHOLD = 300; // drag below this → snap to collapsed strip
	const COLLAPSED_WIDTH = 48; // width of compact icon strip

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
		const delta = e.clientX - _startX;
		const raw = _side === 'left' ? _startW + delta : _startW - delta;
		const next = raw < COLLAPSE_THRESHOLD ? COLLAPSED_WIDTH : Math.max(COLLAPSE_THRESHOLD, raw);
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
			<!-- Compact collapsed strip — no side padding -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				class="lg:flex gap-2 py-4 hidden shrink-0 cursor-pointer flex-col items-center border-r-2 border-border bg-muted transition-colors hover:bg-muted/70"
				style="width: {COLLAPSED_WIDTH}px"
				role="button"
				tabindex="0"
				onclick={() => (leftWidth = DEFAULT_WIDTH)}
				onkeydown={(e) => e.key === 'Enter' && (leftWidth = DEFAULT_WIDTH)}
				title="Expand left panel"
			>
				{#each leftTabs as tab}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="w-8 h-8 rounded text-xs font-semibold shadow-sm flex shrink-0 items-center justify-center bg-background text-foreground transition-colors select-none hover:bg-accent"
						title={tab.label}
						role="button"
						tabindex="-1"
						onclick={(e) => { e.stopPropagation(); requestedLeftTabId = tab.id; leftWidth = DEFAULT_WIDTH; }}
					>
						{tab.icon || tab.label[0]?.toUpperCase() || '?'}
					</div>
				{/each}
				<div class="mt-auto text-muted-foreground">
					<ChevronRight size={14} />
				</div>
			</div>
		{:else}
			<!-- Expanded left panel — with side padding -->
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

		<!-- Left drag handle (desktop only, shown when sidebar exists) -->
		{#if hasSidebar}
			<div
				class="lg:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
				style="width: 6px"
				onmousedown={(e) => startDrag('left', e)}
				role="separator"
				aria-orientation="vertical"
			>
				<div
					class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"
				></div>
			</div>
		{/if}
	{/if}

	<!-- ── Viewer ──────────────────────────────────────────────────────────────── -->
	{#if hasViewer}
		<Viewer {schema} {meshes} bind:isFullscreen={isViewerFullscreen} {isSolving} />
	{/if}

	<!-- ── Right drag handle ──────────────────────────────────────────────────── -->
	{#if hasRightPanel}
		<div
			class="lg:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
			style="width: 6px"
			onmousedown={(e) => startDrag('right', e)}
			role="separator"
			aria-orientation="vertical"
		>
			<div
				class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"
			></div>
		</div>
	{/if}

	<!-- ── Right panel ────────────────────────────────────────────────────────── -->
	{#if hasRightPanel}
		{#if rightCollapsed}
			<!-- Compact collapsed strip — no side padding -->
			<!-- svelte-ignore a11y_interactive_supports_focus -->
			<div
				class="lg:flex gap-2 py-4 hidden shrink-0 cursor-pointer flex-col items-center border-l-2 border-border bg-muted transition-colors hover:bg-muted/70"
				style="width: {COLLAPSED_WIDTH}px"
				role="button"
				tabindex="0"
				onclick={() => (rightWidth = DEFAULT_WIDTH)}
				onkeydown={(e) => e.key === 'Enter' && (rightWidth = DEFAULT_WIDTH)}
				title="Expand right panel"
			>
				<div class="mb-1 text-muted-foreground">
					<ChevronLeft size={14} />
				</div>
				{#each rightTabs as tab}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="w-8 h-8 rounded text-xs font-semibold shadow-sm flex shrink-0 items-center justify-center bg-background text-foreground transition-colors select-none hover:bg-accent"
						title={tab.label}
						role="button"
						tabindex="-1"
						onclick={(e) => { e.stopPropagation(); requestedRightTabId = tab.id; rightWidth = DEFAULT_WIDTH; }}
					>
						{tab.icon || tab.label[0]?.toUpperCase() || '?'}
					</div>
				{/each}
			</div>
		{:else}
			<!-- Expanded right panel — with side padding -->
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
				<!-- StateManager + CalculateButton follow the tabs: only here when no left tabs -->
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
