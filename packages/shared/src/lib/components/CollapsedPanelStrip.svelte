<script lang="ts">
	import type { TabConfig } from '../types/generated';
	import { ChevronRight, ChevronLeft, ChevronDown } from '@lucide/svelte';

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
	class="flex gap-2 py-3 lg:py-4 shrink-0 cursor-pointer flex-row lg:flex-col items-center bg-muted transition-colors hover:bg-muted/70 w-full lg:w-auto px-3 lg:px-0 {side ===
	'left'
		? 'border-b-2 lg:border-b-0 lg:border-r-2 rounded-b-md lg:rounded-b-none lg:rounded-r-md'
		: 'border-b-2 lg:border-b-0 lg:border-l-2 rounded-b-md lg:rounded-b-none lg:rounded-l-md'} border-border"
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

	<!-- Desktop chevrons (start/end of column) -->
	{#if side === 'right'}
		<div class="hidden lg:block mb-1 text-muted-foreground">
			<ChevronLeft size={14} />
		</div>
	{/if}

	{#each tabs as tab (tab.id)}
		<button
			type="button"
			class="w-8 h-8 rounded text-xs font-semibold shadow-sm flex shrink-0 items-center justify-center bg-background text-foreground transition-colors select-none hover:bg-accent"
			title={tab.label}
			onclick={(e) => {
				e.stopPropagation();
				onTabClick(tab.id);
			}}
		>
			{tab.icon || tab.label[0]?.toUpperCase() || '?'}
		</button>
	{/each}

	{#if side === 'left'}
		<div class="hidden lg:block mt-auto text-muted-foreground">
			<ChevronRight size={14} />
		</div>
	{/if}
</div>
