<script lang="ts">
	import type { Component } from 'svelte';
	import Icon from '@iconify/svelte';

	interface Props {
		/** An Iconify id (`mdi:home`) or up to two letters. */
		icon?: string;
		/** Drawn when the tab has no icon. */
		fallback?: Component;
	}

	let { icon, fallback: Fallback }: Props = $props();
</script>

{#if icon?.includes(':')}
	<Icon {icon} class="size-4 shrink-0" />
{:else if icon}
	<span class="shrink-0 text-xs leading-none font-semibold">{icon.slice(0, 2)}</span>
{:else if Fallback}
	<Fallback class="size-4 shrink-0" />
{/if}
