<script lang="ts">
	import { AlertCircle } from '@lucide/svelte';
	import * as Card from './ui/card/index.js';
	import { Button } from './ui/button/index.js';

	interface Props {
		status?: number;
		message?: string;
		details?: string;
		homeLink?: string;
	}

	let { status = 500, message, details, homeLink = '/' }: Props = $props();
</script>

<div
	class="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-slate-800 p-4"
>
	<Card.Root class="w-full max-w-md">
		<Card.Header class="text-center">
			<div class="mb-4 flex justify-center">
				<div class="bg-destructive/10 rounded-full p-3">
					<AlertCircle class="text-destructive h-8 w-8" />
				</div>
			</div>
			<Card.Title class="text-3xl">{status}</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
				<div class="flex gap-3">
					<AlertCircle class="text-destructive mt-0.5 h-4 w-4 shrink-0" />
					<div class="flex-1">
						<p class="text-destructive text-sm font-semibold">Error</p>
						{#if message}
							<p class="text-destructive/80 text-sm">{message}</p>
						{/if}
					</div>
				</div>
			</div>

			{#if details}
				<div class="rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
					<p class="font-mono text-sm break-all text-slate-600 dark:text-slate-400">
						{details}
					</p>
				</div>
			{/if}
		</Card.Content>
		<Card.Footer class="flex gap-2">
			<Button variant="outline" class="flex-1">
				<a href={homeLink} class="w-full">Go Home</a>
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
