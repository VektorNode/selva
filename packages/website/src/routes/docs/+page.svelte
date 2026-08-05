<script lang="ts">
	import { getDoc, getDocsIndex } from '$lib/docs';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';

	// Only shown below `md`, where the layout's sidebar is hidden — without it the
	// rest of the docs would be unreachable from this page on a phone.
	const index = getDocsIndex();

	// A curated "start here" path for a first-time reader, in the order it makes
	// sense to read them. Resolved against the published docs so a renamed or
	// unpublished doc simply drops out instead of 404-ing.
	const startHere = [
		{ slug: 'what-is-selva', hint: 'The 2-minute overview' },
		{ slug: 'self-hosting/get-started/overview', hint: 'Three steps to a deployment' },
		{ slug: 'architecture', hint: 'How the parts fit together' }
	]
		.map((s) => ({ ...s, doc: getDoc(s.slug) }))
		.filter((s) => s.doc);
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
	<h1 class="text-4xl font-bold tracking-tight">Documentation</h1>
	<p class="text-muted-foreground mt-4 max-w-2xl text-lg">
		Selva is pre-release. These pages cover what it is and how it's put together — guides for the
		plugin, providers, and deployment land with the first release.
	</p>

	{#if startHere.length}
		<ol class="mt-10 grid gap-4 sm:grid-cols-3">
			{#each startHere as item, i (item.slug)}
				<li>
					<a
						href={`/docs/${item.slug}`}
						class="group border-border bg-card hover:border-muted-foreground/40 flex h-full flex-col rounded-xl border p-5 transition hover:shadow-sm"
					>
						<span class="text-muted-foreground text-xs font-semibold">Step {i + 1}</span>
						<span class="text-foreground mt-1 font-semibold">{item.doc?.title}</span>
						<span class="text-muted-foreground mt-1 text-sm leading-relaxed">{item.hint}</span>
						<span
							class="text-primary mt-4 inline-flex items-center gap-1 text-sm opacity-0 transition group-hover:opacity-100"
						>
							Read <ArrowRight class="size-3.5" />
						</span>
					</a>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="text-muted-foreground mt-8">No published docs yet.</p>
	{/if}

	<div class="mt-14 space-y-8 md:hidden">
		{#each index as group (group.title)}
			<section>
				<h2 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
					{group.title}
				</h2>
				<ul class="mt-3 space-y-1">
					{#each group.entries as doc (doc.slug)}
						<li>
							<a
								href={`/docs/${doc.slug}`}
								class="text-muted-foreground hover:text-foreground hover:bg-muted/60 block rounded-md px-3 py-1.5 text-sm transition"
							>
								{doc.title}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
</div>
