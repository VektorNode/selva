<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '@selvajs/ui';
	import { Settings, Users, Shield } from '@lucide/svelte';
	import type { Component } from 'svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';

	interface Props {
		platformPermissions?: PlatformPermission[];
		orgPermissions?: OrgPermission[];
	}

	let { platformPermissions = [], orgPermissions = [] }: Props = $props();

	let open = $state(false);
	let triggerEl = $state<HTMLButtonElement | null>(null);
	let menuEl = $state<HTMLDivElement | null>(null);

	const isPlatformAdmin = $derived(platformPermissions.includes('instance_admin'));

	const ANY_PLATFORM_PERM: PlatformPermission[] = [
		'instance_admin',
		'manage_compute',
		'manage_instance_users',
		'manage_updates'
	];
	const ANY_ORG_ADMIN_PERM: OrgPermission[] = [
		'manage_org_members',
		'manage_org_compute',
		'manage_definitions',
		'manage_projects'
	];

	const showAdmin = $derived(
		isPlatformAdmin || ANY_PLATFORM_PERM.some((p) => platformPermissions.includes(p))
	);
	const showTeam = $derived(
		isPlatformAdmin || ANY_ORG_ADMIN_PERM.some((p) => orgPermissions.includes(p))
	);

	const items = $derived(
		[
			{
				href: '/team',
				label: 'Team',
				description: 'Members, projects, and org-wide settings',
				icon: Users as Component,
				show: showTeam,
				match: 'prefix' as const
			},
			{
				href: '/admin',
				label: 'Admin',
				description: 'Platform configuration and instance settings',
				icon: Shield as Component,
				show: showAdmin,
				match: 'prefix' as const
			}
		].filter((i) => i.show)
	);

	const hasAny = $derived(items.length > 0);

	function isActive(href: string): boolean {
		return page.url.pathname.startsWith(href);
	}

	function handleClickOutside(event: MouseEvent) {
		if (!open) return;
		const target = event.target as Node;
		if (triggerEl?.contains(target) || menuEl?.contains(target)) return;
		open = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) open = false;
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

{#if hasAny}
	<div class="relative">
		<Button
			bind:ref={triggerEl}
			onclick={() => (open = !open)}
			variant="outline"
			size="icon"
			aria-label="Settings"
			aria-expanded={open}
			aria-haspopup="menu"
		>
			<Settings class="h-[1.2rem] w-[1.2rem]" />
		</Button>

		{#if open}
			<div
				bind:this={menuEl}
				role="menu"
				class="absolute right-0 top-full z-50 mt-1.5 w-64 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md"
			>
				<div class="p-1">
					{#each items as item (item.href)}
						{@const Icon = item.icon}
						{@const active = isActive(item.href)}
						<a
							href={item.href}
							role="menuitem"
							onclick={() => (open = false)}
							class={`flex items-start gap-2.5 rounded-sm px-2.5 py-2 text-sm transition-colors ${
								active
									? 'bg-accent text-accent-foreground'
									: 'text-foreground hover:bg-muted/60'
							}`}
						>
							<Icon class="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" />
							<div class="min-w-0 flex-1">
								<p class="font-medium leading-tight">{item.label}</p>
								<p class="mt-0.5 text-xs leading-snug text-muted-foreground">
									{item.description}
								</p>
							</div>
						</a>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}
