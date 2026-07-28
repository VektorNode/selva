<script lang="ts">
	import { GITHUB_URL } from '$lib/nav';
	import { packagesByCategory } from '$lib/packages';
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

	const groups = packagesByCategory();

	// One-line intent per category, shown under each section heading.
	const categoryBlurb: Record<string, string> = {
		'App & UI': 'The runnable app, the schema designer, and the shared component library.',
		'Core libraries': 'Reusable, mostly UI-free building blocks you can consume on their own.',
		Providers: 'Swappable backends for auth, data, and storage — pick one at deploy time.',
		Tooling: 'The command-line tool that scaffolds and operates a deployment.'
	};
</script>

<svelte:head>
	<title>Packages · Selva</title>
	<meta
		name="description"
		content="The @selvajs/* workspace: the deployable app, core libraries, swappable providers, and CLI tooling."
	/>
</svelte:head>

<div class="mx-auto max-w-6xl px-6 py-16">
	<!-- Header -->
	<div class="max-w-2xl">
		<h1 class="text-4xl font-bold tracking-tight">Packages</h1>
		<p class="text-muted-foreground mt-4 text-lg text-pretty">
			Selva is a monorepo of focused <code class="bg-muted rounded px-1.5 py-0.5 text-base"
				>@selvajs/*</code
			> packages. Deploy the whole app, or consume the viewer, compute client, and provider interfaces
			directly in your own product.
		</p>
		<div class="mt-6 flex flex-wrap gap-4 text-sm">
			<a
				href="/docs/getting-started/build-your-own-app"
				class="text-primary font-medium hover:underline">Build your own app →</a
			>
			<a
				href={`${GITHUB_URL}/tree/main/packages`}
				target="_blank"
				rel="noreferrer"
				class="text-muted-foreground hover:text-foreground">Browse the source →</a
			>
		</div>
	</div>

	<!-- Categories -->
	<div class="mt-14 space-y-16">
		{#each groups as group (group.title)}
			<section>
				<h2 class="text-2xl font-semibold tracking-tight">{group.title}</h2>
				{#if categoryBlurb[group.title]}
					<p class="text-muted-foreground mt-1 text-sm">{categoryBlurb[group.title]}</p>
				{/if}

				<div class="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
					{#each group.items as pkg (pkg.name)}
						<a
							href={pkg.href}
							target="_blank"
							rel="noreferrer"
							class="group border-border bg-card hover:border-muted-foreground/40 flex flex-col rounded-xl border p-5 transition hover:shadow-sm"
						>
							<div class="flex items-start justify-between gap-3">
								<code class="text-foreground text-sm font-semibold break-all">{pkg.name}</code>
								<ArrowUpRight
									class="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition"
								/>
							</div>
							<p class="text-primary mt-2 text-sm font-medium">{pkg.tagline}</p>
							<p class="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">
								{pkg.description}
							</p>
							{#if pkg.badge}
								<span
									class="border-border text-muted-foreground mt-4 inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs"
								>
									{pkg.badge}
								</span>
							{/if}
						</a>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	<!-- Footer note -->
	<div class="border-border mt-16 border-t pt-8">
		<p class="text-muted-foreground text-sm">
			Not sure where to start? Read <a
				href="/docs/what-is-selva"
				class="text-primary hover:underline">What is Selva</a
			>
			for the big picture, or the
			<a href="/architecture" class="text-primary hover:underline">Architecture</a> page to see how these
			pieces fit together at runtime.
		</p>
	</div>
</div>
