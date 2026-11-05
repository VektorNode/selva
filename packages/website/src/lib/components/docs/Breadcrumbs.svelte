<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	interface Crumb {
		label: string;
		/** Omitted for a group, which has no page of its own. */
		href?: string;
	}

	let { items }: { items: Crumb[] } = $props();
</script>

{#if items.length > 1}
	<nav aria-label="Breadcrumb" class="text-muted-foreground mb-6 text-sm">
		<ol class="flex flex-wrap items-center gap-1.5">
			{#each items as item, i (item.label)}
				{@const last = i === items.length - 1}
				<li class="flex items-center gap-1.5">
					{#if item.href && !last}
						<a href={item.href} class="hover:text-foreground transition">{item.label}</a>
					{:else}
						<span class={last ? 'text-foreground' : ''} aria-current={last ? 'page' : undefined}>
							{item.label}
						</span>
					{/if}
					{#if !last}
						<ChevronRight class="size-3.5 shrink-0" aria-hidden="true" />
					{/if}
				</li>
			{/each}
		</ol>
	</nav>
{/if}
