<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import Icon from '@iconify/svelte';

	interface Props {
		side: 'left' | 'right';
		tabs: TabConfig[];
		collapsedWidth: number;
		onExpand: () => void;
		onTabClick: (id: string) => void;
	}

	let { side, tabs, collapsedWidth, onExpand, onTabClick }: Props = $props();

	const railClass = $derived(
		[
			'gap-1 py-2 lg:py-3 lg:flex-col lg:w-auto px-2 lg:px-0',
			'flex w-full shrink-0 flex-row items-center',
			'backdrop-blur-sm bg-background/90 cursor-pointer'
		].join(' ')
	);

	const tabButtonClass =
		'w-8 h-8 rounded cursor-pointer flex shrink-0 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
</script>

<div
	class={railClass}
	style="--collapsed-w: {collapsedWidth}px;"
	role="button"
	tabindex="0"
	aria-label="Expand {side} panel"
	onclick={onExpand}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onExpand()}
>
	{#each tabs as tab (tab.id)}
		<button
			type="button"
			class={tabButtonClass}
			title={tab.label}
			aria-label={tab.label}
			onclick={(e) => {
				e.stopPropagation();
				onTabClick(tab.id);
			}}
		>
			{#if tab.icon}
				{#if tab.icon.includes(':')}
					<Icon icon={tab.icon} class="h-4 w-4" />
				{:else}
					<span class="text-xs font-semibold">{tab.icon}</span>
				{/if}
			{:else}
				<span class="text-xs font-semibold">{tab.label[0]?.toUpperCase() ?? '?'}</span>
			{/if}
		</button>
	{/each}
</div>

<style>
	div {
		min-width: 0;
	}
	@media (min-width: 1024px) {
		div {
			width: var(--collapsed-w);
		}
	}
</style>
