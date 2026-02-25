<script lang="ts">
	import type { TabConfig } from '../types/generated';
	import { ChevronRight, ChevronLeft } from '@lucide/svelte';

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
	class="lg:flex gap-2 py-4 hidden shrink-0 cursor-pointer flex-col items-center bg-muted transition-colors hover:bg-muted/70 {side ===
	'left'
		? 'rounded-r-md border-r-2'
		: 'rounded-l-md border-l-2'} border-border"
	style="width: {collapsedWidth}px"
	role="button"
	tabindex="0"
	onclick={onExpand}
	onkeydown={(e) => e.key === 'Enter' && onExpand()}
	title="Expand {side} panel"
>
	{#if side === 'right'}
		<div class="mb-1 text-muted-foreground">
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
		<div class="mt-auto text-muted-foreground">
			<ChevronRight size={14} />
		</div>
	{/if}
</div>
