<script lang="ts">
	import { Button, Card } from '@selva/shared';

	interface Props {
		isRunning?: boolean;
		logs?: string;
		exitCode?: number | null;
		onRun?: () => void;
	}

	let { isRunning = false, logs = '', exitCode = null, onRun }: Props = $props();
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>Application Update</Card.Title>
		<Card.Description>Run the update script to pull latest changes and restart</Card.Description>
	</Card.Header>
	<Card.Content class="space-y-4">
		<Button onclick={onRun} disabled={isRunning} variant="destructive">
			{isRunning ? 'Running…' : 'Run Update'}
		</Button>
		{#if logs}
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Update Logs</h4>
				<pre
					class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs"
				>{logs}</pre>
				{#if exitCode !== null}
					<p
						class="text-sm font-medium {exitCode === 0
							? 'text-green-600 dark:text-green-400'
							: 'text-destructive'}"
					>
						Process exited with code: {exitCode}
					</p>
				{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>
