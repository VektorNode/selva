<script lang="ts">
	import type { UISchema, SupportedTypes } from '../types/generated';
	import { ChevronUp } from '@lucide/svelte';
	import Viewer from './Viewer.svelte';
	import CalculateButton from './ui/CalculateButton.svelte';
	import SolvingIndicator from './ui/SolvingIndicator.svelte';
	import StateManager from './StateManager.svelte';
	import TabLayout from './preview/TabLayout.svelte';
	import CollapsedPanelStrip from './CollapsedPanelStrip.svelte';
	import * as Resizable from '$lib/components/ui/resizable';

	// ── Constants ────────────────────────────────────────────────────────────────
	const COLLAPSED_WIDTH = 48;

	// ── Props ────────────────────────────────────────────────────────────────────
	interface Props {
		schema: UISchema;
		meshes?: any[];
		isSolving: boolean;
		showSolvingIndicator?: boolean;
		hasPendingChanges?: boolean;
		hasNeverSolved?: boolean;
		isViewerFullscreen?: boolean;
		oncalculate?: () => void;
		values: Record<string, unknown>;
		onValueChange: (id: string, val: SupportedTypes) => void | Promise<void>;
		onLoadValues?: () => void | Promise<void>;
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
		values = $bindable({}),
		onValueChange,
		onLoadValues
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
	let drawerOpen = $state(false);

	const activeLeftTabLabel = $derived(leftTabs[0]?.label ?? 'Parameters');

	$effect(() => {
		const mqMobile = window.matchMedia('(max-width: 639px)');
		function update() {
			isMobile = mqMobile.matches;
		}
		update();
		mqMobile.addEventListener('change', update);
		return () => mqMobile.removeEventListener('change', update);
	});

	// ── Panel collapse state ──────────────────────────────────────────────────────
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

{#snippet panelContent(
	panelFilter: 'left' | 'right' | undefined,
	requestedTabId: string | null,
	showStateManager = true,
	showCalculateButton = true
)}
	<div class="panel-content-wrapper">
		{#if schema.layout.type === 'tabbed'}
			<TabLayout {schema} bind:values {onValueChange} {panelFilter} {requestedTabId} />
		{/if}
		{#if showStateManager || (!isMobile && showCalculateButton && schema.instanceSolve === false)}
			<div class="panel-footer px-3">
				{#if showStateManager}
					<StateManager {schema} currentValues={values} onLoadValues={handleLoadValues} />
				{/if}
				{#if !isMobile && showCalculateButton && schema.instanceSolve === false}
					<CalculateButton {hasPendingChanges} {hasNeverSolved} {isSolving} {oncalculate} />
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<!-- ── Root container ─────────────────────────────────────────────────────────── -->
<div
	data-layout-root
	class="min-h-0 sm:flex-row flex flex-1 flex-col overflow-hidden"
	class:fullscreen-layout={isViewerFullscreen}
	class:relative={isMobile}
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
						<CalculateButton {hasPendingChanges} {hasNeverSolved} {isSolving} {oncalculate} />
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
						<CalculateButton {hasPendingChanges} {hasNeverSolved} {isSolving} {oncalculate} />
					</div>
				{/if}
			</div>
		{/if}
	{:else}
		<!-- ═══ DESKTOP LAYOUT ═════════════════════════════════════════════════════ -->

		{#if !hasViewer && !isTwoPanelMode && (hasLeftPanel !== hasRightPanel)}
			<!-- Single centered panel (left-only or right-only), no viewer -->
			<div class="min-h-0 flex h-full flex-1 justify-center">
				<div class="min-h-0 flex h-full flex-col w-1/2">
					{@render panelContent(
						hasRightPanel ? 'right' : undefined,
						hasRightPanel ? requestedRightTabId : requestedLeftTabId,
						!hasRightPanel,
						!hasRightPanel
					)}
				</div>
			</div>
		{:else}
			<div class="min-h-0 flex flex-1">
				<!-- Left collapsed strip (outside PaneGroup so it has fixed width) -->
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
					<!-- Left pane -->
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
							class={leftCollapsed ? 'pointer-events-none hidden' : 'bg-transparent'}
						/>
					{/if}

					<!-- Viewer pane -->
					{#if hasViewer}
						<Resizable.Pane order={2} minSize={20} class="min-h-0 mx-1 flex flex-col">
							<Viewer {schema} {meshes} bind:isFullscreen={isViewerFullscreen} {isSolving} />
						</Resizable.Pane>
					{/if}

					<!-- Right pane -->
					{#if hasRightPanel}
						<Resizable.Handle
							class={rightCollapsed ? ' pointer-events-none hidden' : 'bg-transparent'}
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
						>
							<div
								class="min-h-0 flex h-full flex-col {isViewerFullscreen || rightCollapsed
									? 'hidden'
									: ''}"
							>
								{@render panelContent('right', requestedRightTabId, !hasLeftPanel, !hasLeftPanel)}
							</div>
						</Resizable.Pane>
					{/if}
				</Resizable.PaneGroup>

				<!-- Right collapsed strip -->
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

	.panel-content-wrapper {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.panel-footer {
		flex-shrink: 0;
		padding-top: 1.5rem;
		padding-bottom: 1rem;
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
</style>
