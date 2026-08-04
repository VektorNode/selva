<script lang="ts">
	import ParametricHero from '$lib/components/ParametricHero.svelte';
	import PipelineGraph from '$lib/components/PipelineGraph.svelte';

	const status = [
		{ label: 'Grasshopper plugin', detail: 'Rhino 8 and 9, Windows and macOS', done: true },
		{ label: 'Web app and 3D viewer', detail: 'Solving through Rhino.Compute', done: true },
		{ label: 'Public source release', detail: 'Not yet', done: false }
	];
</script>

<svelte:head>
	<title>Selva — Grasshopper-driven web apps</title>
	<meta
		name="description"
		content="Selva turns Rhino Grasshopper definitions into web applications — design the UI in Grasshopper, solve on Rhino.Compute, share a link. In development."
	/>
</svelte:head>

<!-- Hero: the claim on the left, the claim demonstrated on the right. -->
<section class="mx-auto max-w-6xl px-6 pt-16 pb-16 sm:pt-24">
	<div class="grid items-center gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
		<div>
			<span
				class="border-border bg-muted/50 text-muted-foreground mb-6 inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs"
			>
				<span class="bg-primary size-1.5 animate-pulse rounded-full"></span>
				in development
			</span>
			<h1 class="text-5xl font-bold tracking-tight text-balance sm:text-6xl">
				Your definition,<br />
				<span class="text-primary">someone else's browser.</span>
			</h1>
			<p class="text-muted-foreground mt-6 max-w-lg text-lg text-pretty">
				Selva puts a Grasshopper model on the web without a front end. You wire the interface on the
				canvas; the people who need the model just move sliders.
			</p>
			<p class="text-muted-foreground/80 mt-5 max-w-lg text-sm text-pretty">
				Being built right now, not public yet. The demo on the right is the idea in miniature — drag
				something.
			</p>
		</div>

		<ParametricHero />
	</div>
</section>

<!-- The pipeline, drawn as wired nodes. -->
<section class="mx-auto max-w-6xl px-6 py-16">
	<h2 class="text-muted-foreground mb-6 font-mono text-xs tracking-widest uppercase">
		Canvas to link
	</h2>
	<PipelineGraph />
</section>

<!-- Status, stated plainly. -->
<section class="mx-auto max-w-6xl px-6 py-16 pb-28">
	<div class="border-border bg-card mx-auto max-w-2xl rounded-2xl border p-8 sm:p-10">
		<h2 class="text-2xl font-bold tracking-tight">Where things stand</h2>
		<ul class="mt-6 space-y-4">
			{#each status as item (item.label)}
				<li class="flex items-baseline gap-3">
					<span
						class="mt-1 size-2 shrink-0 rounded-full {item.done
							? 'bg-primary'
							: 'border-muted-foreground/50 border'}"
						aria-hidden="true"
					></span>
					<span
						class="flex flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
					>
						<span class="font-medium">{item.label}</span>
						<span class="text-muted-foreground text-sm">{item.detail}</span>
					</span>
				</li>
			{/each}
		</ul>
		<p class="text-muted-foreground mt-8 text-sm leading-relaxed">
			No sign-up, no waitlist. Check back here — this page changes when there's something to try.
		</p>
	</div>
</section>
