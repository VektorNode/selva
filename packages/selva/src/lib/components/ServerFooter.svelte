<script lang="ts">
	import { Server } from '@lucide/svelte';

	interface Props {
		label: string | null;
	}
	let { label }: Props = $props();
</script>

{#if label}
	<div class="text-muted-foreground flex items-center gap-1.5 text-xs">
		<Server class="h-3 w-3" />
		<span>{label}</span>
	</div>
{/if}
