<script lang="ts">
	import { page } from '$app/state';
	import { getDocsSidebar } from '$lib/docs';

	let { children } = $props();

	const docsNav = getDocsSidebar();
</script>

<div class="mx-auto flex max-w-6xl gap-10 px-6 py-12">
	<!-- Sidebar -->
	<aside class="hidden w-56 shrink-0 md:block">
		<nav class="sticky top-24 space-y-6">
			{#each docsNav as section (section.title)}
				<div>
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{section.title}
					</h3>
					<ul class="mt-2 space-y-1">
						{#each section.links as link (link.href)}
							{@const active = page.url.pathname === link.href}
							<li>
								<a
									href={link.href}
									class="block rounded-md px-3 py-1.5 text-sm transition {active
										? 'bg-muted text-foreground font-medium'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}"
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</nav>
	</aside>

	<!-- Content -->
	<article class="prose prose-headings:scroll-mt-24 max-w-none min-w-0 flex-1">
		{@render children()}
	</article>
</div>
