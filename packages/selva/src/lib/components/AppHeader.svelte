<script lang="ts">
	import { page } from '$app/state';
	import { Button, AppShell, ModeToggle } from '@selvajs/ui';
	import type { Snippet } from 'svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
	import MainNav from './MainNav.svelte';
	import UserChip from './UserChip.svelte';
	import SettingsMenu from './SettingsMenu.svelte';
	import MobileMenu from './MobileMenu.svelte';

	interface Props {
		homeUrl?: string;
		title?: string | null;
		mode?: 'fixed' | 'scroll';
		sidenav?: Snippet;
		showMainNav?: boolean;
		rightExtras?: Snippet;
		/** Off on a page that offers sign-in in its own body, so guests don't see it twice. */
		showSignIn?: boolean;
		children: Snippet;
	}

	let {
		homeUrl = '/',
		title = undefined,
		mode = 'scroll',
		sidenav,
		showMainNav = true,
		rightExtras,
		showSignIn = true,
		children
	}: Props = $props();

	const pageData = $derived(
		page.data as {
			user?: { platformPermissions?: PlatformPermission[] } | null;
			ctx?: { orgPermissions?: OrgPermission[]; mayHoldApiTokens?: boolean } | null;
			branding?: { name: string; copyrightName: string };
		}
	);
	const isAuthed = $derived(!!pageData.user);
	const platformPermissions = $derived<PlatformPermission[]>(
		pageData.user?.platformPermissions ?? []
	);
	const orgPermissions = $derived<OrgPermission[]>(pageData.ctx?.orgPermissions ?? []);
	const brandName = $derived(pageData.branding?.name ?? 'Selva');
	const copyrightName = $derived(pageData.branding?.copyrightName ?? brandName);
</script>

<AppShell
	{homeUrl}
	{title}
	{mode}
	{sidenav}
	{brandName}
	{copyrightName}
	showFooter
	showModeToggle={false}
>
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
			<!-- Phones get one menu instead: five small icon targets don't fit beside the logo. -->
			<div class="hidden items-center gap-2 sm:flex">
				<UserChip />
				<SettingsMenu
					{platformPermissions}
					{orgPermissions}
					mayHoldApiTokens={pageData.ctx?.mayHoldApiTokens}
				/>
				<ModeToggle />
			</div>
			<div class="sm:hidden">
				<MobileMenu
					{platformPermissions}
					{orgPermissions}
					mayHoldApiTokens={pageData.ctx?.mayHoldApiTokens}
				/>
			</div>
		{:else}
			{#if showSignIn}
				<Button href="/login" size="sm">Sign in</Button>
			{/if}
			<ModeToggle />
		{/if}
	{/snippet}

	{@render children()}
</AppShell>
