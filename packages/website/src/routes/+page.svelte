<script lang="ts">
	import { buttonVariants } from '@selvajs/ui';
	import ShowcaseVideo from '#lib/components/ShowcaseVideo.svelte';
	import { GITHUB_URL } from '#lib/nav.js';

	// Shared shell for the frosted panels so every card reads as the same glass.
	const glass = 'border-border bg-card shadow-raised rounded-xl border';
	const frame = 'border-border w-full rounded-lg border';

	const examples = [
		{
			id: 'lamp',
			audience: 'For industrial designers',
			title: 'Studio Task Lamp',
			body: 'Swap the base, arm and head, pick a finish, and set the real light: colour temperature in kelvin, flux in lumens. Desk illuminance, weight, cost and a tip-over check update with every change.',
			label:
				'Recording of the lamp configurator: the base, arm and head change, then the lamp lights its desk in the Night look.'
		},
		{
			id: 'massing',
			audience: 'For architects',
			title: 'Block Massing Studio',
			body: 'Test a tower or courtyard block on a plot, then switch the facade system and roof. GFA, FAR and a height check update live, and the Night look shows it after dark.',
			label:
				'Recording of the massing configurator: a block changes type and height in its city context, then shows lit windows at night.'
		},
		{
			id: 'shelving',
			audience: 'For furniture makers',
			title: 'Shelving Unit',
			body: 'Set the size and the form offers only what fits. Bay widths, shelf spacings and door layouts are worked out from the width and height you chose.',
			label:
				'Recording of the shelving configurator: the unit grows wider and taller, and gains bays, shelves and doors.'
		},
		{
			id: 'garden',
			audience: 'For landscape designers',
			title: 'Garden Sketch',
			body: 'Walls come from lines, the path from one curve, shrubs from points: drawn in the 3D view, or imported from DXF or 3DM. Heights, widths and sizes stay on sliders.',
			label:
				'Recording of the garden configurator: brick walls, a path and shrubs change size as sliders move.'
		}
	];

	// Raw: a deep proxy of the entry would never equal the entry it wraps.
	let chosen = $state.raw(examples[0]);

	const looks = [
		{ name: 'Showcase', image: 'look-showcase' },
		{ name: 'Arctic', image: 'look-arctic' },
		{ name: 'Line Art', image: 'look-line-art' },
		{ name: 'Night', image: 'look-night' }
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
	<div class="relative mx-auto max-w-(--page-max-w) px-6">
		<!-- ═══ Hero ═══ -->
		<section class="py-16 sm:py-24">
			<div class="{glass} p-8 sm:p-12">
				<p class="text-muted-foreground font-mono text-xs tracking-widest uppercase">
					open source · MIT
				</p>
				<h1
					class="font-display mt-6 text-5xl leading-tight tracking-tight text-balance sm:text-6xl"
				>
					Your workflow,<br />everyone's tool
				</h1>
				<p class="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">
					Publish a Grasshopper definition as a web app. Sliders in, live 3D out. Colleagues and
					clients open a link; they don't need Rhino.
				</p>

				<div class="mt-8 flex flex-wrap items-center gap-3">
					<a
						href="/docs/self-hosting/get-started/quick-start"
						class={buttonVariants({ size: 'lg' })}
					>
						Get started
					</a>
					<a href="/docs/what-is-selva" class={buttonVariants({ variant: 'outline', size: 'lg' })}>
						How it works
					</a>
					<code
						class="border-input bg-field text-muted-foreground rounded-md border px-4 py-2.5 font-mono text-xs"
					>
						npx @selvajs/cli my-deployment
					</code>
				</div>

				<div class="mt-10">
					<ShowcaseVideo
						name="kitchen"
						label="Recording of Selva's web app: a kitchen changes layout, colour and worktop, each cabinet gets its own front and handle, and the order shows a price."
					/>
					<p class="text-muted-foreground mt-3 text-sm">
						Kitchen run, one Grasshopper definition. Recorded in the real app, solved live in Rhino.
					</p>
				</div>
			</div>
		</section>

		<!-- ═══ Examples ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					See what a definition becomes.
				</h2>
				<p class="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
					Four more example configurators, each one Grasshopper definition.
				</p>

				<div
					role="group"
					aria-label="Example"
					class="bg-muted mt-8 inline-flex flex-wrap gap-0.5 rounded-lg p-0.5"
				>
					{#each examples as example (example.id)}
						<button
							type="button"
							aria-pressed={chosen === example}
							onclick={() => (chosen = example)}
							class="rounded-inner border px-3 py-1.5 text-sm font-medium transition {chosen ===
							example
								? 'border-border bg-raised text-foreground shadow-raised'
								: 'text-muted-foreground hover:bg-hover hover:text-foreground border-transparent'}"
						>
							{example.title}
						</button>
					{/each}
				</div>

				<article class="mt-8">
					<p class="text-muted-foreground font-mono text-xs tracking-widest uppercase">
						{chosen.audience}
					</p>
					<h3 class="font-display mt-3 text-2xl tracking-tight">{chosen.title}</h3>
					<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
						{chosen.body}
					</p>
					<div class="mt-5">
						<!-- Remounted per example: a video whose src is swapped stays paused on the old picture. -->
						{#key chosen.id}
							<ShowcaseVideo name={chosen.id} label={chosen.label} />
						{/key}
					</div>
				</article>

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
		{#snippet step(number: number, title: string, body: string)}
			<span class="font-display text-faint-foreground text-4xl leading-none">{number}</span>
			<h3 class="font-display mt-3 text-2xl tracking-tight">{title}</h3>
			<p class="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">{body}</p>
		{/snippet}

		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					From canvas to link in four steps.
				</h2>

				<div class="mt-10 grid gap-14">
					<article>
						{@render step(
							1,
							'Build in Grasshopper',
							'Work as usual. Mark the sliders and toggles people may change and the outputs they get back, then add one UI Bridge component.'
						)}
						<img
							src="/showcase/canvas.webp"
							alt="The kitchen definition on the Grasshopper canvas: grouped inputs on the left, the script in the middle, outputs on the right."
							width="2000"
							height="952"
							loading="lazy"
							class="{frame} mt-5"
						/>
						<figure class="mt-4 grid items-center gap-5 sm:grid-cols-5">
							<figcaption class="text-muted-foreground text-sm leading-relaxed sm:col-span-2">
								The whole connection: a toggle switches the UI Bridge on, and the form layout is
								saved in the .gh file.
							</figcaption>
							<img
								src="/showcase/ui-bridge.webp"
								alt="Three Grasshopper components in a row: a toggle set to True, the UI Bridge showing Ready, and a Schema output."
								width="1200"
								height="280"
								loading="lazy"
								class="{frame} sm:col-span-3"
							/>
						</figure>
					</article>

					<article>
						{@render step(
							2,
							'Lay out the form',
							'Drag parameters into tabs and groups, name them, reorder them, undo. Then try the result against the live definition before anyone else sees it.'
						)}
						<div class="mt-5">
							<ShowcaseVideo
								name="builder"
								label="Recording of the UI builder: tabs and groups of parameters are opened and reordered, the layout is saved, and the preview opens with the 3D kitchen."
							/>
						</div>
					</article>

					<article>
						{@render step(
							3,
							'Use it inside Rhino',
							'The same app runs in a Rhino panel, docked beside the viewport or in its own window. Change a control and the model in Rhino follows.'
						)}
						<div class="mt-5 grid gap-5 sm:grid-cols-2">
							<figure>
								<img
									src="/showcase/rhino-docked.webp"
									alt="Rhino with the kitchen in the viewport and the Selva form docked as a panel on the right."
									width="1600"
									height="900"
									loading="lazy"
									class={frame}
								/>
								<figcaption class="text-muted-foreground mt-2 text-sm">
									Docked as a panel
								</figcaption>
							</figure>
							<figure>
								<img
									src="/showcase/rhino-window.webp"
									alt="Rhino with the Selva app in its own window over the viewport, form and 3D viewer side by side."
									width="1600"
									height="900"
									loading="lazy"
									class={frame}
								/>
								<figcaption class="text-muted-foreground mt-2 text-sm">
									In its own window
								</figcaption>
							</figure>
						</div>
					</article>

					<article>
						{@render step(
							4,
							'Publish and share a link',
							'Upload the .gh to Selva. Colleagues and clients open the tool in a browser, at a desk or on a phone. No Rhino, no file, no canvas. They pick how the model is drawn.'
						)}
						<div class="mt-5 grid items-center gap-5 sm:grid-cols-5">
							<img
								src="/showcase/phone.webp"
								alt="The kitchen configurator on a phone: the 3D viewer on top, the controls below."
								width="600"
								height="1298"
								loading="lazy"
								class="{frame} mx-auto max-w-56 sm:col-span-2"
							/>
							<div class="grid grid-cols-2 gap-4 sm:col-span-3">
								{#each looks as look (look.name)}
									<figure>
										<img
											src="/showcase/{look.image}.webp"
											alt="The kitchen in the {look.name} look."
											width="900"
											height="740"
											loading="lazy"
											class={frame}
										/>
										<figcaption class="text-muted-foreground mt-2 text-sm">{look.name}</figcaption>
									</figure>
								{/each}
							</div>
						</div>
					</article>
				</div>
			</div>
		</section>

		<!-- ═══ Teams ═══ -->
		<section class="py-8">
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					Run it for a team.
				</h2>
				<p class="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
					Each organization has its own members, projects and access tokens, on your own server.
				</p>
				<figure class="mt-8">
					<img
						src="/showcase/team-members.webp"
						alt="Selva's Members and roles page: five members with owner, admin and member roles, per-member permissions, and a list of pending invites."
						width="1600"
						height="1346"
						loading="lazy"
						class="{frame} aspect-video object-cover object-top"
					/>
					<figcaption class="text-muted-foreground mt-2 text-sm">
						Invite by email, give each person a role, and set who may manage definitions and
						projects.
					</figcaption>
				</figure>
				<div class="mt-6 grid gap-5 sm:grid-cols-2">
					<figure>
						<img
							src="/showcase/team-projects.webp"
							alt="Selva's Projects page: five projects, each private or open to the organization, with a member count."
							width="1600"
							height="900"
							loading="lazy"
							class={frame}
						/>
						<figcaption class="text-muted-foreground mt-2 text-sm">
							Projects group definitions. Keep one private or open it to the organization.
						</figcaption>
					</figure>
					<figure>
						<img
							src="/showcase/team-tokens.webp"
							alt="Selva's API tokens page: setup steps for connecting an AI agent over MCP, and the list of existing tokens."
							width="1600"
							height="900"
							loading="lazy"
							class={frame}
						/>
						<figcaption class="text-muted-foreground mt-2 text-sm">
							API tokens for scripts and integrations, and an MCP address so an AI assistant can
							find definitions and run solves.
						</figcaption>
					</figure>
				</div>
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
							<h3 class="text-foreground font-semibold">{who.title}</h3>
							<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{who.body}</p>
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
						<h3 class="text-foreground font-semibold">Host it for your team</h3>
						<p class="text-muted-foreground mt-3 text-sm leading-relaxed">
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
						<h3 class="text-foreground font-semibold">Or build your own</h3>
						<p class="text-muted-foreground mt-3 text-sm leading-relaxed">
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
				<ul class="text-foreground flex flex-wrap gap-x-8 gap-y-2 text-sm font-semibold">
					{#each trust as item (item)}
						<li class="flex items-center gap-2">
							<span class="bg-faint-foreground size-1.5 rounded-full"></span>{item}
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
