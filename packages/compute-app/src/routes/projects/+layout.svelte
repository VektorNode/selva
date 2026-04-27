<script lang="ts">
	import { PageHeader, PageContent } from '@selvajs/ui';
	import UserChip from '$lib/components/UserChip.svelte';
	import MainNav from '$lib/components/MainNav.svelte';
	import SettingsMenu from '$lib/components/SettingsMenu.svelte';
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

<PageHeader homeUrl="/library">
	{#snippet navItems()}
		<MainNav />
	{/snippet}
	{#snippet rightContent()}
		<UserChip />
		<SettingsMenu
			platformPermissions={data.user?.platformPermissions ?? []}
			orgPermissions={data.ctx?.orgPermissions ?? []}
		/>
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
