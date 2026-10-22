<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import { DropdownMenu, Button } from '@selvajs/ui';
	import { Menu, LogOut, Sun, Moon, Check } from '@lucide/svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
	import { mainNavLinks, settingsLinks, isActiveLink, type NavLink } from './navItems';
	import { userLabel, canLogOut, type IdentityPageData } from './userIdentity';

	interface Props {
		platformPermissions?: PlatformPermission[];
		orgPermissions?: OrgPermission[];
		mayHoldApiTokens?: boolean;
	}

	let { platformPermissions = [], orgPermissions = [], mayHoldApiTokens = false }: Props = $props();

	const pageData = $derived(
		page.data as IdentityPageData & {
			user?: { email?: string } | null;
			ctx?: { platformPermissions?: string[]; orgPermissions?: string[] } | null;
		}
	);
	const label = $derived(userLabel(pageData));
	const email = $derived(pageData.user?.email);
	const mainLinks = $derived(mainNavLinks(pageData.ctx ?? undefined));
	const adminLinks = $derived(
		settingsLinks({ platformPermissions, orgPermissions, mayHoldApiTokens })
	);
	const showLogout = $derived(canLogOut(pageData));

	// Lives outside the menu content, which unmounts on close before the submit would land.
	let logoutForm = $state<HTMLFormElement | null>(null);
</script>

{#snippet linkItem(link: NavLink)}
	{@const active = isActiveLink(link, page.url.pathname)}
	{@const Icon = link.icon}
	<DropdownMenu.Item class="min-h-11">
		{#snippet child({ props })}
			<a href={link.href} aria-current={active ? 'page' : undefined} {...props}>
				<Icon class="size-4 opacity-70" />
				<span class="flex-1">{link.label}</span>
				{#if active}<Check class="size-4" aria-hidden="true" />{/if}
			</a>
		{/snippet}
	</DropdownMenu.Item>
{/snippet}

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="outline" size="icon-lg" aria-label="Menu">
				<Menu class="size-5" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" sideOffset={8} class="w-[min(18rem,calc(100vw-2rem))]">
		<div class="px-3 py-2">
			<p class="truncate text-sm font-medium">{label}</p>
			{#if email && email !== label}
				<p class="text-muted-foreground truncate text-xs">{email}</p>
			{/if}
		</div>
		<DropdownMenu.Separator />

		{#each mainLinks as link (link.href)}
			{@render linkItem(link)}
		{/each}

		{#if adminLinks.length > 0}
			<DropdownMenu.Separator />
			{#each adminLinks as link (link.href)}
				{@render linkItem(link)}
			{/each}
		{/if}

		<DropdownMenu.Separator />
		<DropdownMenu.Item class="min-h-11" closeOnSelect={false} onSelect={toggleMode}>
			{#if mode.current === 'dark'}
				<Sun class="size-4 opacity-70" />
				Light mode
			{:else}
				<Moon class="size-4 opacity-70" />
				Dark mode
			{/if}
		</DropdownMenu.Item>
		{#if showLogout}
			<DropdownMenu.Item class="min-h-11" onSelect={() => logoutForm?.requestSubmit()}>
				<LogOut class="size-4 opacity-70" />
				Log out
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

{#if showLogout}
	<form bind:this={logoutForm} method="POST" action="/logout" use:enhance hidden></form>
{/if}
