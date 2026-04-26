<script lang="ts">
	import { PageHeader, PageContent } from '@selvajs/shared';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface LayoutData {
		user?: { platformPermissions?: PlatformPermission[] } | null;
		ctx?: { orgPermissions?: OrgPermission[] } | null;
	}
	interface LayoutProps {
		data: LayoutData;
		children?: import('svelte').Snippet;
	}
	let { data, children }: LayoutProps = $props();
</script>

<PageHeader homeUrl="/app">
	{#snippet navItems()}
		<MainNav
			platformPermissions={data.user?.platformPermissions ?? []}
			orgPermissions={data.ctx?.orgPermissions ?? []}
		/>
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
