<script lang="ts">
	import { featuredPackages, packages } from '$lib/packages';
	import { FOOD4RHINO_URL, YAK_PACKAGE_NAME } from '$lib/nav';

	const CONTACT_EMAIL = 'felix@vektornode.com';
</script>

<svelte:head>
	<title>Selva — Grasshopper-driven web apps</title>
	<meta
		name="description"
		content="Selva turns Rhino Grasshopper definitions into web applications — design the UI in Grasshopper, solve on Rhino.Compute, share a link. The Grasshopper plugin is available on Food4Rhino and in Rhino's Package Manager."
	/>
</svelte:head>

<section class="mx-auto max-w-7xl px-6 pt-16 pb-16 sm:pt-24">
	<div class="mx-auto max-w-2xl text-center">
		<span
			class="border-border bg-muted/50 text-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs"
		>
			<span class="bg-primary size-1.5 animate-pulse rounded-full"></span>
			plugin out now · web app in development
		</span>
		<h1 class="text-4xl font-bold tracking-tight text-balance sm:text-5xl">
			Grasshopper logic,<br />
			<span class="text-primary">made shareable.</span>
		</h1>
		<p class="text-muted-foreground/80 mt-6 text-sm text-pretty">
			The plugin is out now. The hosted web app is still in development.
		</p>

		<div class="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
			<a
				href={FOOD4RHINO_URL}
				target="_blank"
				rel="noreferrer"
				class="bg-primary text-primary-foreground inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
			>
				Install from Food4Rhino
			</a>
			<p class="text-muted-foreground text-sm">
				or search <code class="text-foreground font-semibold">{YAK_PACKAGE_NAME}</code> in Rhino's Package
				Manager
			</p>
		</div>
	</div>
</section>

<!-- What it's built from: a teaser, the full list lives on /packages. -->
<section class="mx-auto max-w-7xl px-6 py-16">
	<div class="flex flex-wrap items-baseline justify-between gap-4">
		<div class="max-w-2xl">
			<h2 class="text-2xl font-bold tracking-tight">What it's built from</h2>
			<p class="text-muted-foreground mt-2 text-pretty">
				Small, separate pieces rather than one big program. Run the whole thing as it comes, or take
				just the parts you need into a product of your own.
			</p>
		</div>
		<a href="/packages" class="text-primary text-sm font-medium hover:underline">
			See all {packages.length} packages →
		</a>
	</div>

	<div class="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
		{#each featuredPackages as pkg (pkg.name)}
			<div class="border-border bg-card flex flex-col rounded-xl border p-5">
				<code class="text-foreground text-sm font-semibold break-all">{pkg.name}</code>
				<p class="text-primary mt-2 text-sm font-medium">{pkg.tagline}</p>
				<p class="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">{pkg.description}</p>
			</div>
		{/each}
	</div>
</section>

<!-- Contact: the only thing to do on this page while Selva is unreleased. -->
<section class="mx-auto max-w-7xl px-6 py-16 pb-28">
	<div class="border-border bg-card mx-auto max-w-2xl rounded-2xl border p-8 sm:p-10">
		<h2 class="text-2xl font-bold tracking-tight">Interested?</h2>
		<p class="text-muted-foreground mt-4 leading-relaxed">
			The plugin is out; the rest is still being built. If you are using it, have a project it would
			fit, or want to support the work, write to me.
		</p>
		<a
			href="mailto:{CONTACT_EMAIL}?subject=Selva"
			class="bg-primary text-primary-foreground mt-8 inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
		>
			{CONTACT_EMAIL}
		</a>
	</div>
</section>
