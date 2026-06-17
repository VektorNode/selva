<script lang="ts">
	import { footerNav } from '$lib/nav';
	import logo from '$lib/assets/selva-logo.svg';

	const year = new Date().getFullYear();
</script>

<footer class="border-border mt-24 border-t">
	<div class="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-4">
		<div class="sm:col-span-2 md:col-span-1">
			<a href="/" class="flex items-center gap-2 text-lg font-bold tracking-tight">
				<img src={logo} alt="" class="h-7 w-7" />
				Selva
			</a>
			<p class="text-muted-foreground mt-2 max-w-xs text-sm">
				Grasshopper-driven web applications.
			</p>
		</div>

		{#each footerNav as section (section.title)}
			<div>
				<h3 class="text-foreground text-sm font-semibold">{section.title}</h3>
				<ul class="mt-3 space-y-2">
					{#each section.links as link (link.href)}
						<li>
							<a
								href={link.href}
								target={link.external ? '_blank' : undefined}
								rel={link.external ? 'noreferrer' : undefined}
								class="text-muted-foreground hover:text-foreground text-sm transition"
							>
								{link.label}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>

	<div class="border-border border-t">
		<div class="text-muted-foreground mx-auto max-w-6xl px-6 py-6 text-sm">
			© {year} Selva. MIT licensed.
		</div>
	</div>
</footer>
