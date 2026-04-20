<script lang="ts">
	import { page } from '$app/state';

	import { PageHeader } from 'selva-shared';
	import UserChip from '$lib/components/UserChip.svelte';
	import type { Permission } from '@selva/platform';
	import { hasPermission } from '@selva/platform';

	interface LayoutData {
		permissions: Permission[];
	}
	interface LayoutProps {
		data: LayoutData;
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();


	const can = (p: Permission) => hasPermission(data.permissions, p);

	const navItems = $derived([
		{ href: '/admin', label: 'Dashboard', show: true },
		{ href: '/admin/definitions', label: 'Definitions', show: can('manage_definitions') },
		{ href: '/admin/projects', label: 'Projects', show: can('manage_projects') },
		{ href: '/admin/users', label: 'Users', show: can('manage_users') },
		{ href: '/admin/compute', label: 'Compute', show: can('manage_compute') }
	].filter((i) => i.show));

	const isActive = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<div class="bg-background min-h-screen">
	<PageHeader title="Selva Admin" showModeToggle={true}>
		{#snippet rightContent()}
			<UserChip />
		{/snippet}
	</PageHeader>

	<!-- Nav tabs -->
	<div class="border-b">
		<nav class="mx-auto flex max-w-7xl gap-1 px-6 sm:px-6 lg:px-8">
			{#each navItems as item (item.href)}
				<a
					href={item.href}
					class="border-b-2 px-3 py-3 text-sm font-medium transition-colors {isActive(item.href)
						? 'border-primary text-foreground'
						: 'text-muted-foreground hover:text-foreground border-transparent'}"
				>
					{item.label}
				</a>
			{/each}
		</nav>
	</div>

	<main class="mx-auto max-w-7xl py-6 sm:px-6 lg:px-8">
		{@render children?.()}
	</main>
</div>
