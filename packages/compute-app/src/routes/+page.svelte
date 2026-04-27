<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '@selvajs/ui';
	import AppHeader from '$lib/components/AppHeader.svelte';

	const isAuthed = $derived(!!page.data.user);
</script>

<svelte:head>
	<title>Selva</title>
</svelte:head>

<AppHeader homeUrl="/">
	<div class="flex flex-1 flex-col items-center justify-center px-4 text-center">
		<div class="max-w-md space-y-6">
			<h1 class="text-4xl font-bold tracking-tight">Selva</h1>
			<p class="text-muted-foreground text-lg">
				Turn Grasshopper definitions into tools anyone can use.
			</p>
			<div class="flex justify-center gap-3">
				{#if isAuthed}
					<Button href="/library">Open library</Button>
				{:else}
					<Button href="/login">Sign in</Button>
				{/if}
			</div>
		</div>
	</div>
</AppHeader>
