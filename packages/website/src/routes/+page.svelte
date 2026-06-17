<script lang="ts">
	import { GITHUB_URL } from '$lib/nav';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Globe from '@lucide/svelte/icons/globe';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	const features = [
		{
			icon: Boxes,
			title: 'Grasshopper-native',
			description:
				'Link a definition, design your UI, and ship. Selva speaks Grasshopper end to end.'
		},
		{
			icon: Globe,
			title: 'Deployable web apps',
			description:
				'Solve definitions through Rhino.Compute and serve them as standalone web applications.'
		},
		{
			icon: ShieldCheck,
			title: 'Type-safe by design',
			description:
				'One schema generates both the TypeScript UI and the C# plugin types, kept in sync.'
		}
	];
</script>

<svelte:head>
	<title>Selva — Grasshopper-driven web apps</title>
	<meta
		name="description"
		content="Selva turns Rhino Grasshopper definitions into deployable web applications."
	/>
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-6xl px-6 pt-24 pb-16 text-center">
	<h1 class="mx-auto max-w-3xl text-5xl font-bold tracking-tight sm:text-6xl">
		Turn Grasshopper definitions into web apps
	</h1>
	<p class="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg">
		Selva is a cross-platform Rhino Grasshopper plugin with a web UI for building Grasshopper-driven
		web applications — from local designer to deployed app.
	</p>
	<div class="mt-10 flex items-center justify-center gap-4">
		<a
			href="/docs"
			class="bg-primary text-primary-foreground rounded-md px-6 py-3 font-medium transition hover:opacity-90"
		>
			Get started
		</a>
		<a
			href={GITHUB_URL}
			target="_blank"
			rel="noreferrer"
			class="border-border hover:bg-muted rounded-md border px-6 py-3 font-medium transition"
		>
			View on GitHub
		</a>
	</div>
</section>

<!-- Features -->
<section class="mx-auto max-w-6xl px-6 py-16">
	<div class="grid gap-8 md:grid-cols-3">
		{#each features as feature (feature.title)}
			<div class="border-border bg-card rounded-lg border p-6">
				<feature.icon class="text-primary size-8" />
				<h2 class="mt-4 text-lg font-semibold">{feature.title}</h2>
				<p class="text-muted-foreground mt-2 text-sm leading-relaxed">
					{feature.description}
				</p>
			</div>
		{/each}
	</div>
</section>

<!-- CTA -->
<section class="mx-auto max-w-6xl px-6 py-16">
	<div class="border-border bg-card rounded-xl border px-8 py-14 text-center">
		<h2 class="text-3xl font-bold tracking-tight">Ready to build?</h2>
		<p class="text-muted-foreground mx-auto mt-3 max-w-xl">
			Read the docs to install the plugin and deploy your first Selva app.
		</p>
		<a
			href="/docs"
			class="bg-primary text-primary-foreground mt-8 inline-block rounded-md px-6 py-3 font-medium transition hover:opacity-90"
		>
			Read the docs
		</a>
	</div>
</section>
