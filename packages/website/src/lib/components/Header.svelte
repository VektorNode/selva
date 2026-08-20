<script lang="ts">
	import { page } from '$app/state';
	import { primaryNav, FOOD4RHINO_URL } from '$lib/nav';
	import logo from '$lib/assets/selva-logo.svg';

	// A nav link is active when the current path matches it, or lives beneath it
	// (so /docs/... keeps "Docs" lit). "/" only matches exactly.
	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<!-- Floating pill nav: the header bar itself is transparent; the pill carries
     the surface, so it reads as an object over the page rather than a bar. -->
<header class="sticky top-0 z-50 px-4 pt-4">
	<div
		class="border-border bg-background/80 supports-[backdrop-filter]:bg-background/60 mx-auto flex max-w-fit items-center gap-1 rounded-full border py-1.5 pr-1.5 pl-4 shadow-sm backdrop-blur"
	>
		<a href="/" class="mr-2 flex shrink-0 items-center gap-2 text-base font-bold tracking-tight">
			<img src={logo} alt="" class="h-6 w-6" />
			Selva
		</a>

		<!-- Scrollable on narrow screens so links never overlap the logo. -->
		<nav
			class="flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden"
		>
			{#each primaryNav as link (link.href)}
				{@const active = !link.external && isActive(link.href)}
				<a
					href={link.href}
					target={link.external ? '_blank' : undefined}
					rel={link.external ? 'noreferrer' : undefined}
					aria-current={active ? 'page' : undefined}
					class="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition {active
						? 'text-foreground bg-muted'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<a
			href={FOOD4RHINO_URL}
			target="_blank"
			rel="noreferrer"
			class="bg-primary text-primary-foreground ml-2 shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition hover:opacity-90"
		>
			Install
		</a>
	</div>
</header>
