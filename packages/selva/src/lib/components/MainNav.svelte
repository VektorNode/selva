<script lang="ts">
	import { page } from '$app/state';
	import { mainNavLinks, isActiveLink } from './navItems';

	const items = $derived(
		mainNavLinks(
			(page.data as { ctx?: { platformPermissions?: string[]; orgPermissions?: string[] } }).ctx
		)
	);
</script>

<!-- Phones reach these through MobileMenu. -->
{#each items as item (item.href)}
	{@const active = isActiveLink(item, page.url.pathname)}
	{@const Icon = item.icon}
	<a
		href={item.href}
		aria-current={active ? 'page' : undefined}
		class={[
			'hidden h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors sm:flex',
			active
				? 'bg-accent text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
		].join(' ')}
	>
		<Icon class="h-3.5 w-3.5" />
		<span>{item.label}</span>
	</a>
{/each}
