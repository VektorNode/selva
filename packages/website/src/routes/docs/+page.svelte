<script lang="ts">
	import { getDocsIndex, getDoc } from '$lib/docs';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Compass from '@lucide/svelte/icons/compass';

	const index = getDocsIndex();

	// A curated "start here" path for a first-time reader, in the order it makes
	// sense to read them. Resolved against the published docs so a renamed or
	// unpublished doc simply drops out instead of 404-ing.
	const startHere = [
		{ slug: 'what-is-selva', hint: 'The 2-minute overview' },
		{ slug: 'getting-started/overview', hint: 'Three steps to a deployment' },
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
		Everything you need to install, configure, and deploy Selva — sourced directly from the
		repository, so the docs never drift from the code.
	</p>

	<!-- Start here -->
	{#if startHere.length}
		<div class="border-border bg-card mt-10 rounded-xl border p-6">
			<div class="text-primary flex items-center gap-2 text-sm font-semibold">
				<Compass class="size-4" />
				New here? Start with these
			</div>
			<ol class="mt-4 grid gap-3 sm:grid-cols-3">
				{#each startHere as item, i (item.slug)}
					<li>
						<a
							href={`/docs/${item.slug}`}
							class="group border-border hover:border-muted-foreground/40 hover:bg-muted/40 flex h-full flex-col rounded-lg border p-4 transition"
						>
							<span class="text-muted-foreground text-xs font-semibold">Step {i + 1}</span>
							<span class="text-foreground mt-1 font-medium">{item.doc?.title}</span>
							<span class="text-muted-foreground mt-1 text-sm">{item.hint}</span>
							<span
								class="text-primary mt-3 inline-flex items-center gap-1 text-sm opacity-0 transition group-hover:opacity-100"
							>
								Read <ArrowRight class="size-3.5" />
							</span>
						</a>
					</li>
				{/each}
			</ol>
		</div>
	{/if}

	<!-- All docs, grouped -->
	<div class="mt-14 space-y-14">
		{#each index as group (group.title)}
			<section>
				<h2 class="text-2xl font-semibold tracking-tight">{group.title}</h2>
				<div class="mt-5 grid gap-4 sm:grid-cols-2">
					{#each group.entries as doc (doc.slug)}
						<a
							href={`/docs/${doc.slug}`}
							class="group border-border bg-card hover:border-muted-foreground/40 flex flex-col rounded-xl border p-5 transition hover:shadow-sm"
						>
							<div class="flex items-center justify-between gap-3">
								<h3 class="text-foreground font-semibold">{doc.title}</h3>
								<ArrowRight
									class="text-muted-foreground group-hover:text-foreground size-4 shrink-0 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100"
								/>
							</div>
							{#if doc.description}
								<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{doc.description}</p>
							{/if}
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	{#if index.length === 0}
		<p class="text-muted-foreground mt-8">No published docs yet.</p>
	{/if}
</div>
