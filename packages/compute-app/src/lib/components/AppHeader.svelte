<script lang="ts">
	import { page } from '$app/state';
	import { Button, AppShell } from '@selvajs/ui';
	import type { Snippet } from 'svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
	import MainNav from './MainNav.svelte';
	import UserChip from './UserChip.svelte';
	import SettingsMenu from './SettingsMenu.svelte';

	interface Props {
		homeUrl?: string;
		title?: string | null;
		mode?: 'fixed' | 'scroll';
		sidenav?: Snippet;
		// When true (the default), MainNav renders next to the logo for authed users.
		showMainNav?: boolean;
		// Extra items to inject into the right cluster, before UserChip.
		rightExtras?: Snippet;
		children: Snippet;
	}

	let {
		homeUrl = '/library',
		title = undefined,
		mode = 'scroll',
		sidenav,
		showMainNav = true,
		rightExtras,
		children
	}: Props = $props();

	const pageData = $derived(
		page.data as {
			user?: { platformPermissions?: PlatformPermission[] } | null;
			ctx?: { orgPermissions?: OrgPermission[] } | null;
		}
	);
	const isAuthed = $derived(!!pageData.user);
	const platformPermissions = $derived<PlatformPermission[]>(
		pageData.user?.platformPermissions ?? []
	);
	const orgPermissions = $derived<OrgPermission[]>(pageData.ctx?.orgPermissions ?? []);
</script>

<AppShell {homeUrl} {title} {mode} {sidenav}>
	{#snippet navItems()}
		{#if isAuthed && showMainNav}
			<MainNav />
		{/if}
	{/snippet}

	{#snippet rightContent()}
		{#if rightExtras}
			{@render rightExtras()}
		{/if}
		{#if isAuthed}
			<UserChip />
			<SettingsMenu {platformPermissions} {orgPermissions} />
		{:else}
			<Button href="/login" size="sm">Sign in</Button>
		{/if}
	{/snippet}

	{@render children()}
</AppShell>
