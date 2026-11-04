<script lang="ts">
	import { GITHUB_URL } from '#lib/nav.js';

	// Shared shell for the frosted panels so every card reads as the same glass.
	const glass =
		'rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_12px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl';

	const configurators = [
		{
			audience: 'For industrial designers',
			title: 'Studio Task Lamp',
			body: 'Swap the base, arm and head, pick a finish, and set the real light: colour temperature in kelvin, flux in lumens. Desk illuminance, weight, cost and a tip-over check update with every change.',
			image: '/showcase/lamp-night.webp',
			alt: 'Selva configurator showing a brass desk lamp glowing warm in the dark, lighting its desk, with form controls beside it.',
			detail: '/showcase/lamp-cone.webp',
			detailAlt:
				'A green dome lamp at night, its shade casting a clean edge of light across the desk.',
			caption:
				'The shade blocks real light, so the desk shows the actual cone. Change 2700 K to 6500 K and it turns cool.'
		},
		{
			audience: 'For architects',
			title: 'Block Massing Studio',
			body: 'Test a tower or courtyard block on a plot, then switch the facade system and roof. GFA, FAR and a height check update live, and the Night look shows it after dark.',
			image: '/showcase/courtyard-night.webp',
			alt: 'Selva configurator showing a brick courtyard block at night with scattered lit windows, in its city context.',
			detail: '/showcase/courtyard-day.webp',
			detailAlt: 'The same courtyard block by day, with a green roof, podium and street trees.',
			caption: 'Pick a tower and its twist and taper controls appear. Pick a courtyard and they go.'
		}
	];

	const steps = [
		{
			title: 'Build in Grasshopper',
			body: 'Work as usual. Mark the sliders and toggles people may change, and the outputs they get back.'
		},
		{
			title: 'Publish',
			body: 'Upload the .gh to Selva. Your layout becomes a web app with controls and a live 3D viewer.'
		},
		{
			title: 'Share a link',
			body: 'Colleagues and clients use the tool in a browser. No Rhino, no file, no canvas.'
		}
	];

	const audiences = [
		{
			title: 'Parametric designers',
			body: 'Hand a tool to people who need the result, not the definition. The method stays on your server.'
		},
		{
			title: 'Teams',
			body: 'Organizations, projects and roles decide who can run a definition and who can change it.'
		},
		{
			title: 'Developers',
			body: 'Take the compute client, 3D viewer and controls as npm packages, and build your own product.'
		}
	];

	const trust = ['MIT licensed', 'Self-hosted', 'Pluggable auth, data and storage', 'No lock-in'];
</script>

<svelte:head>
	<title>Selva: Grasshopper definitions as web apps</title>
	<meta
		name="description"
		content="Selva is an open-source (MIT) platform that puts a web UI and live 3D in front of your Rhino Grasshopper definitions. Share a link instead of a file."
	/>
</svelte:head>

<div class="relative isolate -mt-19 overflow-hidden pt-19">
	<div class="relative mx-auto max-w-6xl px-6">
		<!-- ═══ Hero ═══ -->
		<section class="py-16 sm:py-24">
			<div class="{glass} p-8 sm:p-12">
				<p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">open source · MIT</p>
				<h1
					class="font-display mt-6 text-5xl leading-[1.02] tracking-tight text-balance sm:text-6xl"
				>
					Your workflow,<br />everyone's tool
				</h1>
				<p class="mt-6 max-w-2xl text-lg leading-relaxed text-white/70">
					Publish a Grasshopper definition as a web app. Sliders in, live 3D out. Colleagues and
					clients open a link; they don't need Rhino.
				</p>

				<div class="mt-8 flex flex-wrap items-center gap-3">
					<a
						href="/docs/self-hosting/get-started/quick-start"
						class="bg-primary text-primary-foreground rounded-full px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
					>
						Get started
					</a>
					<a
						href="/docs/what-is-selva"
						class="rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/85 transition hover:bg-white/5"
					>
						How it works
					</a>
					<code
						class="rounded-full border border-white/10 bg-black/30 px-4 py-2.5 font-mono text-xs text-white/70"
					>
						npx @selvajs/cli my-deployment
					</code>
				</div>

				<img
					src="/showcase/tower-night.webp"
					alt="Selva's web app: tabs of controls on the left, and a twisting tower with lit windows at night in the 3D viewer on the right."
					width="1800"
					height="973"
					class="mt-10 w-full rounded-2xl border border-white/10"
				/>
			</div>
		</section>

		<!-- ═══ Configurators ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					See what a definition becomes.
				</h2>
				<p class="mt-4 max-w-2xl leading-relaxed text-white/60">
					Two example configurators, each one Grasshopper definition. Screenshots are the real app,
					solved live in Rhino.
				</p>
				<div class="mt-10 grid gap-12">
					{#each configurators as item (item.title)}
						<article>
							<p class="text-primary font-mono text-xs tracking-[0.2em] uppercase">
								{item.audience}
							</p>
							<h3 class="font-display mt-3 text-2xl tracking-tight">{item.title}</h3>
							<p class="mt-2 max-w-2xl text-sm leading-relaxed text-white/60">{item.body}</p>
							<img
								src={item.image}
								alt={item.alt}
								width="1800"
								height="973"
								loading="lazy"
								class="mt-5 w-full rounded-2xl border border-white/10"
							/>
							<figure class="mt-4 grid items-center gap-5 sm:grid-cols-[1fr_1.4fr]">
								<figcaption class="text-sm leading-relaxed text-white/70">
									{item.caption}
								</figcaption>
								<img
									src={item.detail}
									alt={item.detailAlt}
									width="1800"
									height="973"
									loading="lazy"
									class="w-full rounded-xl border border-white/10"
								/>
							</figure>
						</article>
					{/each}
				</div>
				<a
					href="{GITHUB_URL}/tree/main/examples/definitions"
					target="_blank"
					rel="noreferrer"
					class="text-primary mt-8 inline-block text-sm font-semibold hover:underline"
				>
					Open the definitions →
				</a>
			</div>
		</section>

		<!-- ═══ How it works ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					From definition to link in three steps.
				</h2>
				<ol class="mt-8 grid gap-8 sm:grid-cols-3">
					{#each steps as step, i (step.title)}
						<li>
							<span class="font-display text-primary/70 text-4xl leading-none">{i + 1}</span>
							<h3 class="mt-3 font-semibold text-white/90">{step.title}</h3>
							<p class="mt-2 text-sm leading-relaxed text-white/60">{step.body}</p>
						</li>
					{/each}
				</ol>
			</div>
		</section>

		<!-- ═══ Who it's for ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					Made for people who share parametric tools.
				</h2>
				<div class="mt-8 grid gap-8 sm:grid-cols-3">
					{#each audiences as who (who.title)}
						<div>
							<h3 class="font-semibold text-white/90">{who.title}</h3>
							<p class="mt-2 text-sm leading-relaxed text-white/60">{who.body}</p>
						</div>
					{/each}
				</div>
			</div>
		</section>

		<!-- ═══ Paths ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					Choose your path.
				</h2>
				<div class="mt-8 grid gap-10 sm:grid-cols-2">
					<div>
						<h3 class="font-semibold text-white/90">Host it for your team</h3>
						<p class="mt-3 text-sm leading-relaxed text-white/60">
							One deployment on your hardware. Upload definitions, invite people, set permissions.
							Rhino.Compute solves behind the scenes, and the CLI scaffolds the whole thing.
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
							The same parts ship as npm packages: compute client, 3D viewer, controls. Take what
							you need and put your own product around it.
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

		<!-- ═══ Trust ═══ -->
		<section class="py-8 pb-20">
			<div class="{glass} flex flex-wrap items-center justify-between gap-x-8 gap-y-4 p-8 sm:px-10">
				<ul class="flex flex-wrap gap-x-8 gap-y-2 text-sm font-semibold text-white/80">
					{#each trust as item (item)}
						<li class="flex items-center gap-2">
							<span class="bg-primary size-1.5 rounded-full"></span>{item}
						</li>
					{/each}
				</ul>
				<a href="/packages" class="text-primary text-sm font-semibold hover:underline">
					Browse the packages →
				</a>
			</div>
		</section>
	</div>
</div>
