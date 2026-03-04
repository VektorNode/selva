<script lang="ts">
	import type { TabConfig } from '../types/generated';
	import { ChevronRight, ChevronLeft, ChevronDown } from '@lucide/svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		side: 'left' | 'right';
		tabs: TabConfig[];
		collapsedWidth: number;
		onExpand: () => void;
		onTabClick: (id: string) => void;
	}

	let { side, tabs, collapsedWidth, onExpand, onTabClick }: Props = $props();
</script>

<div
	class="gap-2 py-3 lg:py-4 lg:flex-col lg:w-auto px-3 lg:px-0 lg:border-0 flex w-full shrink-0 cursor-pointer flex-row items-center border-2 bg-muted transition-colors hover:bg-muted/70 {side ===
	'left'
		? 'lg:border-r-2 lg:rounded-r-md'
		: 'lg:border-l-2 lg:rounded-l-md'} border-border"
	style="lg:width: {collapsedWidth}px"
	role="button"
	tabindex="0"
	onclick={onExpand}
	onkeydown={(e) => e.key === 'Enter' && onExpand()}
	title="Expand {side} panel"
>
	<!-- Mobile chevron (top of row) -->
	{#if side === 'left'}
		<div class="lg:hidden text-muted-foreground">
			<ChevronDown size={14} />
		</div>
	{/if}

	{#each tabs as tab (tab.id)}
		<button
			type="button"
			class="w-8 h-8 m-1 rounded text-xs font-semibold shadow-sm flex shrink-0 items-center justify-center bg-background text-foreground transition-colors select-none hover:bg-accent/80"
			title={tab.label}
			onclick={(e) => {
				e.stopPropagation();
				onTabClick(tab.id);
			}}
		>
			{#if tab.icon}
				{#if tab.icon.includes(':')}
					<Icon icon={tab.icon} class="h-4 w-4" />
				{:else}
					<span>{tab.icon}</span>
				{/if}
			{:else}
				<span>{tab.label[0]?.toUpperCase() ?? '?'}</span>
			{/if}
		</button>
	{/each}

	{#if side === 'left'}
		<div class="lg:block mt-auto hidden text-muted-foreground">
			<ChevronRight size={14} />
		</div>
	{:else if side === 'right'}
		<div class="lg:block mt-auto hidden text-muted-foreground">
			<ChevronLeft size={14} />
		</div>
	{/if}
</div>
