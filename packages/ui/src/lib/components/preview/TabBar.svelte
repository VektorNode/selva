<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import * as Tabs from '$lib/components/primitives/tabs';
	import { ScrollArea } from '$lib/components/primitives/scroll-area';
	import Icon from '@iconify/svelte';

	interface Props {
		tabs: TabConfig[];
		onTabChange: (tabId: string) => void;
	}

	let { tabs, onTabChange }: Props = $props();

	let viewportRef = $state<HTMLElement | null>(null);

	function handleWheel(e: WheelEvent) {
		if (!viewportRef) return;
		// Trackpad horizontal swipes already produce deltaX: let those pass through.
		if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
		const canScroll = viewportRef.scrollWidth > viewportRef.clientWidth;
		if (!canScroll) return;
		e.preventDefault();
		viewportRef.scrollLeft += e.deltaY;
	}
</script>

<ScrollArea
	bind:viewportRef
	class="w-full shrink-0 border-b border-border"
	orientation="horizontal"
	onwheel={handleWheel}
>
	<Tabs.List
		class="px-2 py-2 gap-0 inline-flex h-auto w-max justify-start rounded-none bg-transparent"
	>
		{#each tabs as tab (tab.id)}
			<Tabs.Trigger
				value={tab.id}
				onclick={() => onTabChange(tab.id)}
				class="group/tab gap-1.5 px-3 py-1 text-sm font-medium relative h-auto flex-none shrink-0 rounded-none border-0 transition-colors not-last:border-r not-last:border-border hover:bg-accent data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=inactive]:text-muted-foreground dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-transparent"
			>
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
</ScrollArea>
