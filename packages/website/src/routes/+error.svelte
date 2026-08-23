<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Page not found' : 'Something went wrong'} · Selva</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto flex max-w-7xl flex-col items-start px-6 py-24">
	<p class="text-muted-foreground font-mono text-sm">{page.status}</p>
	<h1 class="mt-3 text-4xl font-bold tracking-tight">
		{page.status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="text-muted-foreground mt-4 max-w-xl text-lg text-pretty">
		{#if page.status === 404}
			That page doesn't exist — it may have moved or been renamed.
		{:else}
			{page.error?.message ?? 'Try again in a moment.'}
		{/if}
	</p>
	<div class="mt-8 flex flex-wrap gap-4 text-sm">
		<a href="/" class="text-primary font-medium hover:underline">Back home →</a>
		<a href="/packages" class="text-primary font-medium hover:underline">Browse the packages →</a>
	</div>
</div>
