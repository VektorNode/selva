<script lang="ts">
	// Prerendered so adapter-static emits build/404.html, which Firebase Hosting
	// serves for any unmatched path. +error.svelte only covers client-side
	// navigation — it produces no static file.
</script>

<svelte:head>
	<title>Page not found · Selva</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto flex max-w-7xl flex-col items-start px-6 py-24">
	<p class="text-muted-foreground font-mono text-sm">404</p>
	<h1 class="mt-3 text-4xl font-bold tracking-tight">Page not found</h1>
	<p class="text-muted-foreground mt-4 max-w-xl text-lg text-pretty">
		That page doesn't exist — it may have moved or been renamed.
	</p>
	<div class="mt-8 flex flex-wrap gap-4 text-sm">
		<a href="/" class="text-primary font-medium hover:underline">Back home →</a>
		<a href="/packages" class="text-primary font-medium hover:underline">Browse the packages →</a>
	</div>
</div>
