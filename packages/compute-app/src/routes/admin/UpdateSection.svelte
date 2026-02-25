<script lang="ts">
	import { Button, Card } from '@selva/shared';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		isRunning?: boolean;
		isRestarting?: boolean;
		logs?: string;
		exitCode?: number | null;
		onRun?: () => void;
	}

	let { isRunning = false, isRestarting = false, logs = '', exitCode = null, onRun }: Props = $props();

	let logEl = $state<HTMLPreElement>();

	$effect(() => {
		// Auto-scroll to bottom whenever logs change
		if (logs && logEl) {
			logEl.scrollTop = logEl.scrollHeight;
		}
	});

	function buttonLabel() {
		if (isRestarting) return 'Restarting app…';
		if (isRunning) return 'Running…';
		return 'Run Update';
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Application Update</Card.Title>
		<Card.Description>Run the update script to pull latest changes and restart</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<Button onclick={onRun} disabled={isRunning} variant="destructive">
			{#if isRestarting}
				<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
			{/if}
			{buttonLabel()}
		</Button>
		{#if logs}
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Update Logs</h4>
				<pre
					bind:this={logEl}
					class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs"
				>{logs}</pre>
				{#if exitCode !== null}
					<p
						class="text-sm font-medium {exitCode === 0
							? 'text-green-600 dark:text-green-400'
							: 'text-destructive'}"
					>
						{exitCode === 0 ? '✓ Update completed successfully' : `Process exited with code: ${exitCode}`}
					</p>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
