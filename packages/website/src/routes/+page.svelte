<script lang="ts">
	// Shared shell for the frosted panels so every card reads as the same glass.
	const glass =
		'rounded-3xl border border-white/10 bg-white/[0.045] shadow-[0_12px_50px_rgba(0,0,0,0.35)] backdrop-blur-xl';
</script>

<svelte:head>
	<title>Selva: request access</title>
	<meta
		name="description"
		content="Selva is an open-source (MIT) platform that puts a web UI and live 3D in front of your Rhino Grasshopper definitions. Request early access."
	/>
</svelte:head>

<div class="relative isolate -mt-19 overflow-hidden pt-19">
	<div class="relative mx-auto max-w-6xl px-6">
		<!-- ═══ Early access: the page's headline and only call to action ═══ -->
		<section class="py-16 sm:py-24">
			<div class="{glass} p-8 sm:p-12">
				<p class="text-primary font-mono text-xs tracking-[0.25em] uppercase">open source · MIT</p>
				<h1
					class="font-display mt-6 text-5xl leading-[1.02] tracking-tight text-balance sm:text-6xl"
				>
					Your workflow,<br />everyone's tool
				</h1>
			</div>
		</section>

		<!-- ═══ 01 Paths ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">01</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display text-3xl tracking-tight text-balance sm:text-4xl">
					Choose your path.
				</h2>
				<div class="mt-8 grid gap-10 sm:grid-cols-2">
					<div>
						<h3 class="font-semibold text-white/90">Host it on your platform</h3>
						<p class="mt-3 text-sm leading-relaxed text-white/60">
							One deployment on your hardware. Upload definitions, invite people, set permissions:
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
							The same parts ship as npm packages: compute client, 3D viewer, controls. Take what
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

		<!-- ═══ 02 License ═══ -->
		<section class="grid gap-x-12 gap-y-6 py-8 md:grid-cols-[8rem_1fr]">
			<span class="font-display text-primary/60 text-6xl leading-none">02</span>
			<div class="{glass} p-8 sm:p-10">
				<h2 class="font-display max-w-xl text-3xl tracking-tight text-balance sm:text-4xl">
					Open source, all the way down.
				</h2>
				<p class="mt-5 max-w-xl leading-relaxed text-white/60">
					The plugin, the platform, and every <code class="text-white/85">@selvajs</code> package: MIT.
					Auth, data, and storage are pluggable, so you decide where everything lives and how it's managed:
					your disk, your database, your rules.
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
	</div>
</div>
