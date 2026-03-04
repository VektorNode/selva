<script lang="ts">
	import { Circle } from '@lucide/svelte';

	interface Props {
		connected: boolean;
		sessionId?: string;
	}

	let { connected, sessionId }: Props = $props();
</script>

<div class="flex items-center gap-3">
	<div class="flex items-center gap-1.5" title={connected ? 'Connected to Grasshopper' : 'Disconnected from Grasshopper'}>
		<Circle class="h-2.5 w-2.5 shrink-0 fill-current {connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}" />
		<span class="text-xs {connected ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
			{connected ? 'Connected' : 'Disconnected'}
		</span>
	</div>

	{#if sessionId}
		<div class="h-3 w-px bg-border"></div>
		<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
			<span class="shrink-0">Session:</span>
			<code class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-medium text-foreground">
				{sessionId}
			</code>
		</span>
	{/if}
</div>
