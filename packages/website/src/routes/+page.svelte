<script lang="ts">
	import { FOOD4RHINO_URL, YAK_PACKAGE_NAME } from '$lib/nav';

	const CONTACT_EMAIL = 'felix@vektornode.com';

	// Shared shell for the frosted panels so every card reads as the same glass.
	const glass =
		'rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_12px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl';
</script>

<svelte:head>
	<title>Selva — Grasshopper-driven web apps</title>
	<meta
		name="description"
		content="Selva is an open-source (MIT) platform that turns Rhino Grasshopper definitions into web applications — self-host your definitions on your own hardware, solve on Rhino.Compute, share a link. The Grasshopper plugin is available on Food4Rhino and in Rhino's Package Manager."
	/>
</svelte:head>

<!-- The landing commits to one look in both themes: a deep pond of layered
     greens with frosted panels floating on it. Explicit colours, on purpose. -->
<div
	class="relative isolate -mt-19 overflow-hidden pt-19"
	style="background: linear-gradient(180deg, oklch(0.16 0.035 160), oklch(0.13 0.028 152) 55%, oklch(0.15 0.032 158)); color: oklch(0.94 0.012 120);"
>
	<!-- Atmosphere: soft green glows and ripple rings, all decorative. -->
	<div class="pointer-events-none absolute inset-0 -z-10" aria-hidden="true">
		<svg class="absolute top-16 -right-40 size-[44rem] opacity-[0.06]" viewBox="0 0 400 400">
			{#each [36, 74, 116, 162, 199] as r (r)}
				<circle cx="200" cy="200" {r} fill="none" stroke="white" stroke-width="1" />
			{/each}
		</svg>
		<svg class="absolute top-[86rem] -left-52 size-[36rem] opacity-[0.05]" viewBox="0 0 400 400">
			{#each [42, 88, 137, 186] as r (r)}
				<circle cx="200" cy="200" {r} fill="none" stroke="white" stroke-width="1" />
			{/each}
		</svg>
	</div>

	<div class="relative mx-auto max-w-6xl px-6">
		<!-- ═══ Hero: type left, organism right ═══ -->
		<section class="grid items-center gap-x-8 gap-y-14 py-16 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
			<div>
				<p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">open source · MIT</p>
				<h1
					class="font-display mt-6 text-6xl leading-[0.98] tracking-tight text-balance sm:text-7xl"
				>
					Share your workflows
				</h1>
				<p class="mt-7 max-w-md leading-relaxed text-pretty text-white/65">
					Turn Grasshopper definitions into web apps on your own machines. Your team gets a link —
					the definition never leaves the company.
				</p>
				<div class="mt-9 flex flex-wrap items-center gap-6 text-sm">
					<a
						href={FOOD4RHINO_URL}
						target="_blank"
						rel="noreferrer"
						class="bg-primary rounded-full px-6 py-3 font-semibold text-[oklch(0.15_0.025_155)] transition hover:opacity-90"
					>
						Install the plugin
					</a>
					<a
						href="/docs"
						class="text-white/80 underline decoration-white/30 decoration-1 underline-offset-4 transition hover:text-white hover:decoration-white"
					>
						Read the docs
					</a>
				</div>
			</div>
		</section>

		<!-- ═══ 01 Why ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">01</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
					Your know-how lives in .gh files.
				</h2>
				<p class="mt-5 max-w-xl leading-relaxed text-white/60">
					Production logic, analysis tools, years of rules of thumb — sitting in definitions only a
					few specialists can open. Selva turns them into web apps the rest of the company can
					actually use: controls and live 3D for every team, no Rhino, no Grasshopper knowledge.
				</p>
				<p class="mt-4 max-w-xl leading-relaxed text-white/85">
					The file itself stays where you put it — usable by everyone, downloadable by no one.
				</p>
			</div>
		</section>

		<!-- ═══ 02 Workflow ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">02</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
					From canvas to published app.
				</h2>
				<p class="mt-5 max-w-xl leading-relaxed text-white/60">
					Mark the inputs and outputs with Selva components, then arrange them into an interface in
					the browser designer. The layout is saved inside the .gh file itself — nothing to export,
					nothing to drift.
				</p>

				<!-- Viewport-framed slot for the workflow video: swap the inner div
				     for a <video> or embed, keep the chrome. -->
				<div class="mt-8 max-w-2xl overflow-hidden rounded-xl border border-white/10">
					<div
						class="flex items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-2 font-mono text-xs text-white/45"
					>
						<span class="size-2 rounded-full bg-white/20"></span>
						<span class="size-2 rounded-full bg-white/20"></span>
						workflow.mp4
					</div>
					<div class="flex aspect-21/9 items-center justify-center bg-black/25">
						<p class="font-mono text-xs text-white/40">recording the workflow — coming soon</p>
					</div>
				</div>
			</div>
		</section>

		<!-- ═══ 03 Paths ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">03</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					Then choose your path.
				</h2>
				<div class="mt-8 grid gap-10 sm:grid-cols-2">
					<div>
						<h3 class="font-semibold text-white/90">Host it on your platform</h3>
						<p class="mt-3 text-sm leading-relaxed text-white/60">
							One deployment on your hardware. Upload definitions, invite people, set permissions —
							Rhino.Compute solves behind the scenes, and the CLI scaffolds the whole thing under
							your own name.
						</p>
						<a
							href="/docs/self-hosting/get-started/quick-start"
							class="text-primary mt-4 inline-block text-sm font-semibold hover:underline"
						>
							Self-hosting quick start →
						</a>
					</div>
					<div>
						<h3 class="font-semibold text-white/90">Or build your own</h3>
						<p class="mt-3 text-sm leading-relaxed text-white/60">
							The same parts ship as npm packages — compute client, 3D viewer, controls. Take what
							you need and put your own product around it; leave the rest.
						</p>
						<a
							href="/docs/packages/build/overview"
							class="text-primary mt-4 inline-block text-sm font-semibold hover:underline"
						>
							Build your own app →
						</a>
					</div>
				</div>
			</div>
		</section>

		<!-- ═══ 04 License ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">04</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
					Open source, all the way down.
				</h2>
				<p class="mt-5 max-w-xl leading-relaxed text-white/60">
					The plugin, the platform, and every <code class="text-white/85">@selvajs</code> package: MIT.
					Auth, data, and storage are pluggable, so you decide where everything lives and how it's managed
					— your disk, your database, your rules.
				</p>
				<p class="mt-4 max-w-xl leading-relaxed text-white/85">
					Free to use, free to change, free to leave.
				</p>
				<a
					href="/packages"
					class="text-primary mt-5 inline-block text-sm font-semibold hover:underline"
				>
					Browse the packages →
				</a>
			</div>
		</section>

		<!-- ═══ Close ═══ -->
		<section class="py-14">
			<div
				class="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 text-sm text-white/55"
			>
				<p>
					In Rhino's Package Manager as
					<code class="font-semibold text-white/85">{YAK_PACKAGE_NAME}</code>
				</p>
				<nav class="flex flex-wrap gap-x-6 gap-y-2">
					<a href="/docs" class="text-primary font-medium hover:underline">Docs</a>
					<a href="/docs/api/compute/" class="text-primary font-medium hover:underline">API</a>
					<a href="mailto:{CONTACT_EMAIL}?subject=Selva" class="hover:text-white">
						{CONTACT_EMAIL}
					</a>
				</nav>
			</div>
		</section>
	</div>
</div>
