<script lang="ts">
	import { Button, Card, AlertDialog } from '@selvajs/ui';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		isRunning?: boolean;
		isRestarting?: boolean;
		logs?: string;
		exitCode?: number | null;
		onRun?: () => void;
	}

	let {
		isRunning = false,
		isRestarting = false,
		logs = '',
		exitCode = null,
		onRun
	}: Props = $props();

	let logEl = $state<HTMLPreElement>();
	let showRunConfirm = $state(false);

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

	function handleRunClick() {
		showRunConfirm = true;
	}

	function confirmRun() {
		showRunConfirm = false;
		onRun?.();
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Application Update</Card.Title>
		<Card.Description>Run the update script to pull latest changes and restart</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<Button onclick={handleRunClick} disabled={isRunning} variant="destructive">
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
					class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs">{logs}</pre>
				{#if exitCode !== null}
					<p class="text-sm font-medium {exitCode === 0 ? 'text-success' : 'text-destructive'}">
						{exitCode === 0
							? '✓ Update completed successfully'
							: `Process exited with code: ${exitCode}`}
					</p>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<AlertDialog.Root open={showRunConfirm} onOpenChange={(o) => (showRunConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Run Update?</AlertDialog.Title>
			<AlertDialog.Description>
				This will pull the latest changes and restart the application. The service will be
				temporarily unavailable.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmRun} disabled={isRunning}>
				{isRestarting ? 'Restarting…' : 'Continue'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
