<script lang="ts">
	import { primaryNav } from '$lib/nav';
	import logo from '$lib/assets/selva-logo.svg';
</script>

<header
	class="border-border bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 border-b backdrop-blur"
>
	<div class="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
		<a href="/" class="flex items-center gap-2 text-lg font-bold tracking-tight">
			<img src={logo} alt="" class="h-7 w-7" />
			Selva
		</a>

		<nav class="flex items-center gap-1">
			{#each primaryNav as link (link.href)}
				<a
					href={link.href}
					target={link.external ? '_blank' : undefined}
					rel={link.external ? 'noreferrer' : undefined}
					class="text-muted-foreground hover:text-foreground hover:bg-muted rounded-md px-3 py-2 text-sm font-medium transition"
				>
					{link.label}
				</a>
			{/each}
		</nav>
	</div>
</header>
