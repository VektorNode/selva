<script lang="ts">
	import { apiDocsUrl, npmUrl, packagesByCategory, readmeUrl } from '$lib/packages';

	const groups = packagesByCategory();

	// One-line intent per category, shown under each section heading.
	const categoryBlurb: Record<string, string> = {
		'App & UI': 'What you and your users actually see and click.',
		'Core libraries':
			'The engine room: talking to Rhino, drawing the model, deciding when to recalculate. Each works on its own, in your own project.',
		Providers:
			'Where logins, data, and uploaded files live. Sign-in, data, and storage are chosen separately, so you can mix them — Supabase accounts with files on your own disk, or a company login in front of either.',
		Tooling: 'Getting a site running and keeping it running.'
	};
</script>

<svelte:head>
	<title>Packages · Selva</title>
	<meta
		name="description"
		content="The pieces Selva is built from: the web app, the 3D viewer, the Rhino connection, and the parts you can swap out."
	/>
</svelte:head>

<div class="mx-auto max-w-7xl px-6 py-16">
	<!-- Header -->
	<div class="max-w-2xl">
		<h1 class="text-4xl font-bold tracking-tight">Packages</h1>
		<p class="text-muted-foreground mt-4 text-lg text-pretty">
			Selva is built from small, independent pieces — use the whole thing, or take only what you
			need: the Rhino.Compute client, the 3D viewer, the solve flow. Core libraries have no UI
			framework dependency.
		</p>
		<div class="mt-6 flex flex-wrap gap-4 text-sm">
			<a href="/architecture" class="text-primary font-medium hover:underline"
				>How the pieces fit together →</a
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
						<div class="border-border bg-card flex flex-col rounded-xl border p-5">
							<code class="text-foreground text-sm font-semibold break-all">{pkg.name}</code>
							<p class="text-primary mt-2 text-sm font-medium">{pkg.tagline}</p>
							<p class="text-muted-foreground mt-2 flex-1 text-sm leading-relaxed">
								{pkg.description}
							</p>
							<div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
								{#if pkg.badge}
									<span
										class="border-border text-muted-foreground inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs"
									>
										{pkg.badge}
									</span>
								{/if}
								<a
									href={readmeUrl(pkg)}
									class="text-primary text-xs font-medium hover:underline"
									rel="noreferrer"
								>
									Docs
								</a>
								{#if npmUrl(pkg)}
									<a
										href={npmUrl(pkg)}
										class="text-primary text-xs font-medium hover:underline"
										rel="noreferrer"
									>
										npm
									</a>
								{/if}
								{#if apiDocsUrl(pkg)}
									<!-- Typedoc output under static/, not an app route. Without
									     data-sveltekit-reload the router claims the URL, matches it
									     against docs/[...slug], and renders the 404 page instead. -->
									<a
										href={apiDocsUrl(pkg)}
										data-sveltekit-reload
										class="text-primary text-xs font-medium hover:underline"
										rel="noreferrer"
									>
										API reference
									</a>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
	</div>

	<!-- Footer note -->
	<div class="border-border mt-16 border-t pt-8">
		<p class="text-muted-foreground text-sm">
			Not sure where to start? The
			<a href="/architecture" class="text-primary hover:underline">Architecture</a> page shows how these
			pieces fit together at runtime.
		</p>
	</div>
</div>
