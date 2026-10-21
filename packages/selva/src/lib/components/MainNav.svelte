<script lang="ts">
	import { page } from '$app/state';
	import { LayoutGrid, GitBranch } from '@lucide/svelte';
	import type { Component } from 'svelte';

	const ctx = $derived(
		(page.data as { ctx?: { platformPermissions?: string[]; orgPermissions?: string[] } }).ctx
	);
	const canManageProjects = $derived(
		(ctx?.platformPermissions ?? []).includes('instance_admin') ||
			(ctx?.orgPermissions ?? []).some((p) => p === 'manage_definitions' || p === 'manage_projects')
	);

	const items = $derived(
		[
			{
				href: '/library',
				label: 'Library',
				icon: LayoutGrid as Component,
				match: 'prefix',
				show: true
			},
			{
				href: '/projects',
				label: 'Projects',
				icon: GitBranch as Component,
				match: 'prefix',
				show: canManageProjects
			}
		].filter((i) => i.show)
	);

	function isActive(item: (typeof items)[number]): boolean {
		const path = page.url.pathname;
		if (item.match === 'prefix') return path.startsWith(item.href);
		return path === item.href;
	}
</script>

{#each items as item (item.href)}
	{@const active = isActive(item)}
	{@const Icon = item.icon}
	<a
		href={item.href}
		aria-label={item.label}
		title={item.label}
		class={[
			'flex h-9 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors sm:h-8',
			active
				? 'bg-accent text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
		].join(' ')}
	>
		<Icon class="h-4 w-4 sm:h-3.5 sm:w-3.5" />
		<span class="hidden sm:inline">{item.label}</span>
	</a>
{/each}
