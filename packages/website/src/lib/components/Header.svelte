<script lang="ts">
	import { page } from '$app/state';
	import { primaryNav } from '$lib/nav';
	import logo from '$lib/assets/selva-logo.svg';

	// A nav link is active when the current path matches it, or lives beneath it
	// (so /docs/... keeps "Docs" lit). "/" only matches exactly.
	function isActive(href: string): boolean {
		const path = page.url.pathname;
		if (href === '/') return path === '/';
		return path === href || path.startsWith(`${href}/`);
	}
</script>

<header
	class="border-border bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 border-b backdrop-blur"
>
	<div class="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
		<a href="/" class="flex shrink-0 items-center gap-2 text-lg font-bold tracking-tight">
			<img src={logo} alt="" class="h-7 w-7" />
			Selva
		</a>

		<!-- Scrollable on narrow screens so links never overlap the logo. -->
		<nav
			class="-mr-4 ml-auto flex [scrollbar-width:none] items-center gap-0.5 overflow-x-auto px-4 sm:mr-0 sm:gap-1 sm:px-0 [&::-webkit-scrollbar]:hidden"
		>
			{#each primaryNav as link (link.href)}
				{@const active = !link.external && isActive(link.href)}
				<a
					href={link.href}
					target={link.external ? '_blank' : undefined}
					rel={link.external ? 'noreferrer' : undefined}
					aria-current={active ? 'page' : undefined}
					class="shrink-0 rounded-md px-2.5 py-2 text-sm font-medium whitespace-nowrap transition sm:px-3 {active
						? 'text-foreground bg-muted'
						: 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
				>
					{link.label}
				</a>
			{/each}
		</nav>
	</div>
</header>
