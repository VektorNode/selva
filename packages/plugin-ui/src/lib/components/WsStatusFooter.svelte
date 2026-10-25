<script lang="ts">
	import { Circle } from '@lucide/svelte';
	import { isRhinoPanel } from '$lib/utils/session';

	interface Props {
		connected: boolean;
		sessionId?: string;
	}

	let { connected, sessionId }: Props = $props();

	// In Rhino the panel's width is scarce and the session is always the bridge that opened it,
	// so the status collapses to its dot and the rest moves into the tooltip.
	const compact = isRhinoPanel();
	const status = $derived(connected ? 'Connected to Grasshopper' : 'Disconnected from Grasshopper');
</script>

<div class="flex items-center gap-3">
	<div
		class="flex items-center gap-1.5"
		title={compact && sessionId ? `${status} · session ${sessionId}` : status}
	>
		<Circle
			class="h-2.5 w-2.5 shrink-0 fill-current {connected
				? 'text-green-700 dark:text-green-400'
				: 'text-red-600 dark:text-red-400'}"
		/>
		{#if !compact || !connected}
			<span
				class="text-xs {connected
					? 'text-green-700 dark:text-green-400'
					: 'text-red-600 dark:text-red-400'}"
			>
				{connected ? 'Connected' : 'Disconnected'}
			</span>
		{/if}
	</div>

	{#if sessionId && !compact}
		<div class="bg-border h-3 w-px"></div>
		<span class="text-muted-foreground flex items-center gap-1.5 text-xs">
			<span class="shrink-0">Session:</span>
			<code class="bg-muted text-foreground rounded px-1.5 py-0.5 font-mono text-xs font-medium">
				{sessionId}
			</code>
		</span>
	{/if}
</div>
