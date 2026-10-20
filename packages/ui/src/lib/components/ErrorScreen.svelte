<script lang="ts">
	import { AlertCircle } from '@lucide/svelte';
	import * as Card from './primitives/card/index.js';
	import { Button } from './primitives/button/index.js';
	import Callout from './primitives/Callout.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	interface Props {
		status?: number;
		message?: string;
		details?: string;
		homeLink?: string;
	}

	let { status = 500, message, details, homeLink = '/' }: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);
</script>

<div class="p-4 flex min-h-screen items-center justify-center bg-background">
	<Card.Root class="max-w-md w-full">
		<Card.Header>
			<div class="gap-4 flex flex-col items-center text-center">
				<div class="p-3 rounded-full bg-destructive/10">
					<AlertCircle class="size-8 text-destructive" />
				</div>
				<h1 class="text-3xl font-semibold">{status}</h1>
			</div>
		</Card.Header>
		<Card.Content>
			<div class="gap-4 flex flex-col">
				<Callout tone="danger" title={t.errorTitle}>
					{#if message}{message}{/if}
				</Callout>
				{#if details}
					<p class="p-4 font-mono text-sm rounded-lg bg-muted break-all text-muted-foreground">
						{details}
					</p>
				{/if}
			</div>
		</Card.Content>
		<Card.Footer>
			<Button variant="outline" href={homeLink} rel="external" class="w-full">{t.goHome}</Button>
		</Card.Footer>
	</Card.Root>
</div>
