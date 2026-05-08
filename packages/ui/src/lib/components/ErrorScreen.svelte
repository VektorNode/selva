<script lang="ts">
	import { AlertCircle } from '@lucide/svelte';
	import * as Card from './primitives/card/index.js';
	import { Button } from './primitives/button/index.js';

	interface Props {
		status?: number;
		message?: string;
		details?: string;
		homeLink?: string;
	}

	let { status = 500, message, details, homeLink = '/' }: Props = $props();
</script>

<div class="p-4 flex min-h-screen items-center justify-center bg-background">
	<Card.Root class="max-w-md w-full">
		<Card.Header class="text-center">
			<div class="mb-4 flex justify-center">
				<div class="p-3 rounded-full bg-destructive/10">
					<AlertCircle class="h-8 w-8 text-destructive" />
				</div>
			</div>
			<Card.Title class="text-3xl">{status}</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="p-4 rounded-lg border border-destructive/50 bg-destructive/10">
				<div class="gap-3 flex">
					<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
					<div class="flex-1">
						<p class="text-sm font-semibold text-destructive">Error</p>
						{#if message}
							<p class="text-sm text-destructive/80">{message}</p>
						{/if}
					</div>
				</div>
			</div>

			{#if details}
				<div class="p-4 rounded-lg bg-muted">
					<p class="font-mono text-sm break-all text-muted-foreground">
						{details}
					</p>
				</div>
			{/if}
		</Card.Content>
		<Card.Footer class="gap-2 flex">
			<Button variant="outline" class="flex-1">
				<a href={homeLink} class="w-full" rel="external">Go Home</a>
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
