<script lang="ts">
	import { GITHUB_URL } from '$lib/nav';
	import { packages } from '$lib/packages';
	import Boxes from '@lucide/svelte/icons/boxes';
	import Globe from '@lucide/svelte/icons/globe';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import PencilRuler from '@lucide/svelte/icons/pencil-ruler';
	import Server from '@lucide/svelte/icons/server';
	import MousePointerClick from '@lucide/svelte/icons/mouse-pointer-click';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Package from '@lucide/svelte/icons/package';

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

	// The three-actor story: author designs, server solves, user drives.
	const flow = [
		{
			icon: PencilRuler,
			step: 'Design',
			title: 'Map inputs in Grasshopper',
			description:
				'Drop the Selva UI Builder onto your definition and drag its parameters into web controls. The layout — the schema — is saved into the .gh file.'
		},
		{
			icon: Server,
			step: 'Deploy',
			title: 'Solve on Rhino.Compute',
			description:
				'The Selva app loads that schema and solves the definition on a headless Rhino server. Scaffold and run it with one CLI command.'
		},
		{
			icon: MousePointerClick,
			step: 'Share',
			title: 'Anyone drives the model',
			description:
				'Send a link. Users change values in a clean UI and watch the geometry update live in a browser 3D viewer — no Rhino, no install.'
		}
	];

	// A short, honest teaser of the workspace — the full grid lives on /packages.
	const featuredPackages = packages
		.filter((p) =>
			['@selvajs/selva', '@selvajs/compute', '@selvajs/platform', '@selvajs/cli'].includes(p.name)
		)
		.map((p) => ({ name: p.name, tagline: p.tagline }));

	const codeSample = `# Scaffold, configure, and launch a deployment
npx @selvajs/cli my-deployment
cd my-deployment
npm run doctor    # validate config
npm start         # serve the app`;
</script>

<svelte:head>
	<title>Selva — Grasshopper-driven web apps</title>
	<meta
		name="description"
		content="Selva turns Rhino Grasshopper definitions into deployable web applications — design the UI in Grasshopper, solve on Rhino.Compute, share a link."
	/>
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-6xl px-6 pt-24 pb-20 text-center">
	<a
		href="/docs/what-is-selva"
		class="border-border bg-muted/50 text-muted-foreground hover:text-foreground mb-8 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition"
	>
		<span class="bg-primary size-1.5 rounded-full"></span>
		Grasshopper → the web, with no front-end code
	</a>
	<h1 class="mx-auto max-w-3xl text-5xl font-bold tracking-tight text-balance sm:text-6xl">
		Turn Grasshopper definitions into web apps
	</h1>
	<p class="text-muted-foreground mx-auto mt-6 max-w-2xl text-lg text-pretty">
		Selva is a cross-platform Rhino Grasshopper plugin with a web UI for building Grasshopper-driven
		web applications — from local designer to deployed app.
	</p>
	<div class="mt-10 flex flex-wrap items-center justify-center gap-4">
		<a
			href="/docs/getting-started/overview"
			class="bg-primary text-primary-foreground inline-flex items-center gap-2 rounded-md px-6 py-3 font-medium transition hover:opacity-90"
		>
			Get started
			<ArrowRight class="size-4" />
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

	<!-- Terminal card: the shortest path to a running app. -->
	<div class="mx-auto mt-16 max-w-2xl text-left">
		<div class="border-border bg-card overflow-hidden rounded-xl border shadow-sm">
			<div class="border-border flex items-center gap-2 border-b px-4 py-3">
				<span class="size-3 rounded-full bg-red-400/70"></span>
				<span class="size-3 rounded-full bg-yellow-400/70"></span>
				<span class="size-3 rounded-full bg-green-400/70"></span>
				<span class="text-muted-foreground ml-2 text-xs">deploy in three commands</span>
			</div>
			<pre class="overflow-x-auto px-5 py-4 text-sm leading-relaxed"><code class="text-foreground"
					>{codeSample}</code
				></pre>
		</div>
	</div>
</section>

<!-- Features -->
<section class="mx-auto max-w-6xl px-6 py-12">
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

<!-- How it works -->
<section class="mx-auto max-w-6xl px-6 py-20">
	<div class="mx-auto max-w-2xl text-center">
		<h2 class="text-3xl font-bold tracking-tight">How it works</h2>
		<p class="text-muted-foreground mt-3">
			One parametric definition. Three moves from Rhino to a link anyone can open.
		</p>
	</div>

	<div class="mt-14 grid gap-6 md:grid-cols-3">
		{#each flow as stage, i (stage.step)}
			<div class="relative">
				<div class="border-border bg-card h-full rounded-xl border p-6">
					<div class="flex items-center gap-3">
						<div
							class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg"
						>
							<stage.icon class="size-5" />
						</div>
						<span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
							{i + 1}. {stage.step}
						</span>
					</div>
					<h3 class="mt-4 text-lg font-semibold">{stage.title}</h3>
					<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{stage.description}</p>
				</div>
				{#if i < flow.length - 1}
					<div
						class="text-muted-foreground/50 absolute top-1/2 -right-4 hidden -translate-y-1/2 md:block"
						aria-hidden="true"
					>
						<ArrowRight class="size-5" />
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="mt-10 text-center">
		<a
			href="/architecture"
			class="text-primary inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
		>
			See the full architecture
			<ArrowRight class="size-4" />
		</a>
	</div>
</section>

<!-- Packages preview -->
<section class="mx-auto max-w-6xl px-6 py-20">
	<div class="border-border bg-card rounded-2xl border p-8 sm:p-12">
		<div class="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
			<div class="max-w-md">
				<div class="text-primary flex items-center gap-2 text-sm font-semibold">
					<Package class="size-4" />
					Open building blocks
				</div>
				<h2 class="mt-3 text-3xl font-bold tracking-tight">
					Use the whole app, or just the pieces
				</h2>
				<p class="text-muted-foreground mt-3">
					Deploy the standalone app, or pull the viewer, compute client, and provider interfaces
					into your own product. Everything ships as focused <code
						class="bg-muted rounded px-1.5 py-0.5 text-sm">@selvajs/*</code
					> packages.
				</p>
				<a
					href="/packages"
					class="text-primary mt-6 inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
				>
					Browse all packages
					<ArrowRight class="size-4" />
				</a>
			</div>
			<ul class="grid w-full max-w-md gap-3 sm:grid-cols-2">
				{#each featuredPackages as pkg (pkg.name)}
					<li class="border-border bg-background rounded-lg border p-4">
						<code class="text-foreground text-sm font-medium">{pkg.name}</code>
						<p class="text-muted-foreground mt-1 text-xs">{pkg.tagline}</p>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>

<!-- CTA -->
<section class="mx-auto max-w-6xl px-6 pt-4 pb-20">
	<div class="border-border bg-card rounded-xl border px-8 py-14 text-center">
		<h2 class="text-3xl font-bold tracking-tight">Ready to build?</h2>
		<p class="text-muted-foreground mx-auto mt-3 max-w-xl">
			Start with the three-step overview, or jump straight into the docs to install the plugin and
			deploy your first Selva app.
		</p>
		<div class="mt-8 flex flex-wrap items-center justify-center gap-4">
			<a
				href="/docs/getting-started/overview"
				class="bg-primary text-primary-foreground inline-block rounded-md px-6 py-3 font-medium transition hover:opacity-90"
			>
				Get started
			</a>
			<a
				href="/docs"
				class="border-border hover:bg-muted inline-block rounded-md border px-6 py-3 font-medium transition"
			>
				Read the docs
			</a>
		</div>
	</div>
</section>
