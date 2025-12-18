<script>
	import { page } from '$app/state';
	import { Card, Button } from '@selva/shared';
	import { AlertCircle } from '@lucide/svelte';
</script>

<div
	class="flex min-h-screen items-center justify-center bg-linear-to-br from-slate-900 to-slate-800 p-4"
>
	<Card.Root class="w-full max-w-md">
		<Card.Header class="text-center">
			<div class="mb-4 flex justify-center">
				<div class="bg-destructive/10 rounded-full p-3">
					<AlertCircle class="text-destructive h-8 w-8" />
				</div>
			</div>
			<Card.Title class="text-3xl">{page.status}</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-4">
			<div class="border-destructive/50 bg-destructive/10 rounded-lg border p-4">
				<div class="flex gap-3">
					<AlertCircle class="text-destructive mt-0.5 h-4 w-4 shrink-0" />
					<div class="flex-1">
						<p class="text-destructive text-sm font-semibold">Error</p>
						{#if page.error}
							<p class="text-destructive/80 text-sm">{page.error.message}</p>
						{/if}
					</div>
				</div>
			</div>

			{#if page.error && typeof page.error === 'object' && 'details' in page.error}
				<div class="rounded-lg bg-slate-100 p-4 dark:bg-slate-800">
					<p class="font-mono text-sm break-all text-slate-600 dark:text-slate-400">
						{page.error.details}
					</p>
				</div>
			{/if}
		</Card.Content>
		<Card.Footer class="flex gap-2">
			<Button variant="outline" class="flex-1">
				<a href="/" class="w-full">Go Home</a>
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
