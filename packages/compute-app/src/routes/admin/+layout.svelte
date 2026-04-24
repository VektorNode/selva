<script lang="ts">
	import { page } from '$app/state';
	import { PageHeader, PageContent } from 'selva-shared';
	import UserChip from '$lib/components/UserChip.svelte';
	import type { OrgPermission, PlatformPermission } from '@selva/platform';

	interface LayoutData {
		platformPermissions: PlatformPermission[];
		orgPermissions: OrgPermission[];
	}
	interface LayoutProps {
		data: LayoutData;
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();

	// §1g-core: client-side permission check. platform_admin implies every org perm.
	const can = (p: PlatformPermission | OrgPermission) => {
		if (data.platformPermissions.includes('platform_admin')) return true;
		if (p === 'platform_admin') return false;
		return data.orgPermissions.includes(p as OrgPermission);
	};

	const adminNavItems = $derived(
		[
			{ href: '/admin', label: 'General', show: true },
			{ href: '/admin/users', label: 'Users', show: can('manage_users') },
			{ href: '/admin/compute', label: 'Compute', show: can('manage_compute') }
		].filter((i) => i.show)
	);

	const isActive = (href: string) =>
		href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
</script>

<PageHeader title="Admin">
	{#snippet navItems()}
		{#each adminNavItems as item (item.href)}
			<a
				href={item.href}
				class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
					{isActive(item.href) ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}"
			>
				{item.label}
			</a>
		{/each}
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
