<script lang="ts">
	import { buttonVariants } from '@selvajs/ui';
	import { getDocsFlat, getDocsIndex } from '#lib/docs.js';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Search from '@lucide/svelte/icons/search';

	const groups = getDocsIndex();
	const all = getDocsFlat();

	let query = $state('');

	// Titles, descriptions and group names: enough to find a page without an index service.
	const results = $derived.by(() => {
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		if (terms.length === 0) return [];
		return all.filter((doc) => {
			const haystack = `${doc.title} ${doc.description ?? ''} ${doc.group}`.toLowerCase();
			return terms.every((term) => haystack.includes(term));
		});
	});
</script>

<svelte:head>
	<title>Docs · Selva</title>
	<meta
		name="description"
		content="Guides for installing, configuring, and deploying Selva — sourced directly from the repository."
	/>
</svelte:head>

<!-- Opt out of the default prose column: this index is a card layout, not an article. -->
<div class="not-prose">
	<h1 class="text-foreground text-4xl font-semibold tracking-tight">Documentation</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl text-lg text-pretty">
		Run Selva for your team, or build on its packages in your own app.
	</p>

	<div class="mt-8 flex flex-wrap gap-3">
		<a href="/docs/self-hosting/get-started/overview" class={buttonVariants()}>
			Get started <ArrowRight class="size-4" />
		</a>
		<a href="/docs/packages/build/overview" class={buttonVariants({ variant: 'outline' })}>
			Build your own app
		</a>
	</div>

	<label class="relative mt-10 block">
		<span class="sr-only">Search the docs</span>
		<Search
			class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
		/>
		<input
			type="search"
			bind:value={query}
			placeholder="Search the docs"
			autocomplete="off"
			class="border-input bg-card text-foreground placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded-lg border py-2.5 pr-3 pl-9 text-base focus-visible:ring-2 focus-visible:outline-none"
		/>
	</label>

	{#if query.trim()}
		<section class="mt-6" aria-live="polite">
			{#if results.length}
				<ul class="border-border divide-border divide-y rounded-lg border">
					{#each results as doc (doc.slug)}
						<li>
							<a
								href={`/docs/${doc.slug}`}
								class="hover:bg-hover block px-4 py-3 transition first:rounded-t-lg last:rounded-b-lg"
							>
								<span class="text-muted-foreground text-xs">{doc.group}</span>
								<span class="text-foreground mt-0.5 block font-medium">{doc.title}</span>
								{#if doc.description}
									<span class="text-muted-foreground mt-0.5 block text-sm">{doc.description}</span>
								{/if}
							</a>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-muted-foreground text-sm">No pages match “{query.trim()}”.</p>
			{/if}
		</section>
	{:else}
		<div class="mt-12 space-y-12">
			{#each groups as group (group.title)}
				<section>
					<h2 class="text-foreground text-lg font-semibold tracking-tight">{group.title}</h2>
					<ul class="mt-4 grid gap-3 sm:grid-cols-2">
						{#each group.entries as doc (doc.slug)}
							<li>
								<a
									href={`/docs/${doc.slug}`}
									class="group border-border bg-card hover:border-input flex h-full flex-col rounded-xl border p-4 transition"
								>
									<span class="text-foreground flex items-center justify-between gap-2 font-medium">
										{doc.title}
										<ArrowRight
											class="text-muted-foreground size-4 shrink-0 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
										/>
									</span>
									{#if doc.description}
										<span class="text-muted-foreground mt-1 text-sm leading-relaxed">
											{doc.description}
										</span>
									{/if}
								</a>
							</li>
						{/each}
					</ul>
				</section>
			{/each}
		</div>
	{/if}
</div>
