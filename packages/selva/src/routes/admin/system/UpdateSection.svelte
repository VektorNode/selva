<script lang="ts">
	import { Button, Card, AlertDialog } from '@selvajs/ui';
	import { RefreshCw } from '@lucide/svelte';

	interface Props {
		currentVersion?: string;
		isRunning?: boolean;
		isRestarting?: boolean;
		logs?: string;
		exitCode?: number | null;
		onRun?: () => void;
	}

	let {
		currentVersion,
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
		if (isRestarting) return 'Restarting & verifying…';
		if (isRunning) return 'Running…';
		return 'Run Update';
	}

	function statusMessage(): { text: string; tone: 'success' | 'destructive' | 'muted' } | null {
		if (exitCode === null) return null;
		if (exitCode === 0) return { text: '✓ Update completed successfully', tone: 'success' };
		if (exitCode === -2)
			return {
				text: '⚠ App did not respond within 5 minutes after restart — check PM2 logs',
				tone: 'destructive'
			};
		return { text: `Update failed (exit code ${exitCode})`, tone: 'destructive' };
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
		<div class="flex items-start justify-between gap-3">
			<Card.Title>Application Update</Card.Title>
			{#if currentVersion}
				<span
					class="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-xs"
					title="Currently installed @selvajs/selva version"
				>
					v{currentVersion}
				</span>
			{/if}
		</div>
		<Card.Description>Run the update script to pull latest changes and restart</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<Button onclick={handleRunClick} disabled={isRunning} variant="destructive">
			{#if isRestarting}
				<RefreshCw class="mr-2 h-4 w-4 animate-spin" />
			{/if}
			{buttonLabel()}
		</Button>
		{#if isRestarting && exitCode === null}
			<div
				class="border-border bg-muted/50 text-muted-foreground flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
			>
				<RefreshCw class="h-4 w-4 animate-spin" />
				<span>PM2 is restarting the app — waiting for the new process to come online…</span>
			</div>
		{/if}
		{#if logs}
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Update Logs</h4>
				<pre
					bind:this={logEl}
					class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs">{logs}</pre>
				{#if statusMessage()}
					{@const msg = statusMessage()!}
					<p
						class="text-sm font-medium {msg.tone === 'success'
							? 'text-success'
							: msg.tone === 'destructive'
								? 'text-destructive'
								: 'text-muted-foreground'}"
					>
						{msg.text}
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
