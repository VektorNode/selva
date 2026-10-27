<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import * as Tabs from '#lib/components/primitives/tabs/index.js';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';
	import Icon from '@iconify/svelte';
	import { getLocaleContext } from '#lib/i18n/localeContext.svelte.js';

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	interface Props {
		tabs: TabConfig[];
		activeTabId: string;
		onTabChange: (tabId: string) => void;
	}

	let { tabs, activeTabId, onTabChange }: Props = $props();

	const SCROLL_BUTTON_WIDTH = 32;

	let listRef = $state<HTMLElement | null>(null);
	let canScrollBack = $state(false);
	let canScrollForward = $state(false);

	function updateOverflow() {
		if (!listRef) return;
		const { scrollLeft, scrollWidth, clientWidth } = listRef;
		canScrollBack = scrollLeft > 1;
		canScrollForward = scrollLeft + clientWidth < scrollWidth - 1;
	}

	$effect(() => {
		if (!listRef) return;
		const observer = new ResizeObserver(updateOverflow);
		observer.observe(listRef);
		updateOverflow();
		return () => observer.disconnect();
	});

	// A tab picked from the collapsed strip may sit outside the visible strip. Not
	// scrollIntoView: that also scrolls every scrollable ancestor, e.g. the mobile drawer.
	$effect(() => {
		if (!listRef) return;
		const active = listRef.querySelector<HTMLElement>(`[data-value="${CSS.escape(activeTabId)}"]`);
		if (!active) return;
		// Keep the tab clear of the scroll buttons, which overlay the strip's edges.
		const start = active.offsetLeft - SCROLL_BUTTON_WIDTH;
		const end = active.offsetLeft + active.offsetWidth + SCROLL_BUTTON_WIDTH;
		if (start < listRef.scrollLeft) listRef.scrollLeft = start;
		else if (end > listRef.scrollLeft + listRef.clientWidth)
			listRef.scrollLeft = end - listRef.clientWidth;
	});

	function scrollByPage(direction: -1 | 1) {
		listRef?.scrollBy({ left: direction * listRef.clientWidth * 0.7, behavior: 'smooth' });
	}

	function handleWheel(e: WheelEvent) {
		if (!listRef || (!canScrollBack && !canScrollForward)) return;
		// Trackpad horizontal swipes already produce deltaX — let those pass through.
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		e.preventDefault();
		listRef.scrollLeft += e.deltaY;
	}
</script>

<div class="tab-bar relative shrink-0 border-b border-border">
	<Tabs.List bind:ref={listRef} variant="line" onscroll={updateOverflow} onwheel={handleWheel}>
		{#each tabs as tab (tab.id)}
			<Tabs.Trigger value={tab.id} onclick={() => onTabChange(tab.id)} variant="line">
				{#if tab.icon}
					{#if tab.icon.includes(':')}
						<Icon icon={tab.icon} class="h-4 w-4" />
					{:else}
						<span>{tab.icon}</span>
					{/if}
				{/if}
				{tab.label}
			</Tabs.Trigger>
		{/each}
	</Tabs.List>

	{#if canScrollBack}
		<button
			type="button"
			class="scroll-button back"
			aria-label={t.scrollTabsBack}
			onclick={() => scrollByPage(-1)}
		>
			<ChevronLeft class="h-4 w-4" />
		</button>
	{/if}
	{#if canScrollForward}
		<button
			type="button"
			class="scroll-button forward"
			aria-label={t.scrollTabsForward}
			onclick={() => scrollByPage(1)}
		>
			<ChevronRight class="h-4 w-4" />
		</button>
	{/if}
</div>

<style>
	.tab-bar :global([data-slot='tabs-list']) {
		position: relative;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab-bar :global([data-slot='tabs-list']::-webkit-scrollbar) {
		display: none;
	}

	.scroll-button {
		position: absolute;
		top: 0;
		bottom: 1px;
		display: flex;
		align-items: center;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.scroll-button:hover {
		color: var(--foreground);
	}
	.scroll-button.back {
		left: 0;
		padding: 0 1.25rem 0 0.375rem;
		background: linear-gradient(to right, var(--card) 55%, transparent);
	}
	.scroll-button.forward {
		right: 0;
		padding: 0 0.375rem 0 1.25rem;
		background: linear-gradient(to left, var(--card) 55%, transparent);
	}
</style>
