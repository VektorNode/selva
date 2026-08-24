<script lang="ts">
	import { page } from '$app/state';
	import { primaryNav, FOOD4RHINO_URL, GITHUB_URL } from '$lib/nav';
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
			href={GITHUB_URL}
			target="_blank"
			rel="noreferrer"
			aria-label="Selva on GitHub"
			title="Selva on GitHub"
			class="text-muted-foreground hover:text-foreground hover:bg-muted ml-1 flex shrink-0 items-center justify-center rounded-full p-1.5 transition"
		>
			<svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" class="h-5 w-5">
				<path
					d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
				/>
			</svg>
		</a>

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
