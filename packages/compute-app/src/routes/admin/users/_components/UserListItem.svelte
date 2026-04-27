<script lang="ts">
	import { Button } from '@selvajs/ui';
	import { ChevronDown, ChevronRight, Trash2 } from '@lucide/svelte';
	import type { OrgPermission, OrgRole, PlatformPermission } from '@selvajs/platform';
	import {
		ALL_ORG_PERMISSIONS,
		ALL_PLATFORM_PERMISSIONS,
		OWNER_ADMIN_ONLY_PERMISSIONS
	} from '@selvajs/platform';
	import type { UserRow } from '../+page.server';
	import UserAvatar from '$lib/components/UserAvatar.svelte';

	type FlatPermission = PlatformPermission | OrgPermission;

	interface Props {
		user: UserRow;
		expanded: boolean;
		isPlatformAdmin: boolean;
		soleInstanceAdmin: boolean;
		updating: boolean;
		deleting: boolean;
		onToggleExpand: () => void;
		onTogglePermission: (perm: FlatPermission, checked: boolean) => Promise<void>;
		onDelete: () => void;
	}

	let {
		user,
		expanded,
		isPlatformAdmin,
		soleInstanceAdmin,
		updating,
		deleting,
		onToggleExpand,
		onTogglePermission,
		onDelete
	}: Props = $props();

	const PERM_LABEL: Record<FlatPermission, string> = {
		instance_admin: 'Instance admin',
		manage_instance_users: 'Manage instance users',
		manage_compute: 'Manage compute',
		manage_updates: 'Manage updates',
		manage_org_members: 'Manage members',
		manage_org_compute: 'Manage org compute',
		manage_definitions: 'Manage definitions',
		manage_projects: 'Manage projects'
	};

	const PERM_DESC: Record<FlatPermission, string> = {
		instance_admin: 'Full access to every action on the instance.',
		manage_instance_users: 'Create, disable, and delete any user on the instance.',
		manage_compute: 'Configure the instance Rhino.Compute pool.',
		manage_updates: 'Run the application update script.',
		manage_org_members: 'Invite, remove, and change roles of org members.',
		manage_org_compute: 'Configure this org\'s BYO compute server.',
		manage_definitions: 'Upload, edit, and delete any definition in the org.',
		manage_projects: 'Create, edit, and delete any project in the org.'
	};

	const ROLE_TONE: Record<OrgRole, string> = {
		owner: 'border-amber-500/40 text-amber-600 dark:text-amber-400 bg-amber-500/5',
		admin: 'border-blue-500/40 text-blue-600 dark:text-blue-400 bg-blue-500/5',
		member: 'border-border text-muted-foreground'
	};

	const displayLine = $derived(
		user.displayName ? `${user.displayName} · ${user.email ?? user.id}` : (user.email ?? user.id)
	);

	const isOwnerOrAdmin = $derived(user.orgRole === 'owner' || user.orgRole === 'admin');

	// Compact summary chips for collapsed state — only show explicit grants
	// beyond the role default. Owners/admins get all org perms implicitly so
	// they show no chips. Members show their granular org perms.
	const summaryPerms = $derived<FlatPermission[]>(
		user.permissions.filter((p) => {
			if ((ALL_PLATFORM_PERMISSIONS as readonly FlatPermission[]).includes(p)) return true;
			if (isOwnerOrAdmin) return false;
			return true;
		})
	);

	function isPlatformPerm(p: FlatPermission) {
		return (ALL_PLATFORM_PERMISSIONS as readonly FlatPermission[]).includes(p);
	}

	function isOwnerAdminOnly(p: FlatPermission) {
		return (OWNER_ADMIN_ONLY_PERMISSIONS as readonly FlatPermission[]).includes(p);
	}

	function checkboxState(perm: FlatPermission) {
		const checked = user.permissions.includes(perm);
		const platformLocked = isPlatformPerm(perm) && !isPlatformAdmin;
		const soleAdminLock = perm === 'instance_admin' && soleInstanceAdmin;
		// Member excluded from owner/admin-only org perms
		const memberExcluded =
			!isPlatformPerm(perm) && isOwnerAdminOnly(perm) && user.orgRole === 'member';
		const locked = platformLocked || soleAdminLock || memberExcluded;
		return { checked, locked, soleAdminLock, platformLocked, memberExcluded };
	}
</script>

<div class={`px-4 py-3 ${expanded ? 'bg-accent/20' : ''}`}>
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
			onclick={onToggleExpand}
			aria-label={expanded ? 'Collapse permissions' : 'Expand permissions'}
		>
			{#if expanded}
				<ChevronDown class="h-4 w-4" />
			{:else}
				<ChevronRight class="h-4 w-4" />
			{/if}
		</button>

		<UserAvatar name={user.displayName ?? user.email ?? user.id} />

		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<p class="truncate text-sm font-medium">{displayLine}</p>
				{#if user.orgRole}
					<span
						class={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${ROLE_TONE[user.orgRole]}`}
					>
						{user.orgRole}
					</span>
				{/if}
				{#if user.disabled}
					<span
						class="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
					>
						disabled
					</span>
				{/if}
			</div>
			<p class="truncate font-mono text-xs text-muted-foreground">{user.id}</p>
			{#if !expanded && summaryPerms.length > 0}
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each summaryPerms as p (p)}
						<span
							class={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
								isPlatformPerm(p)
									? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
									: 'bg-muted text-muted-foreground'
							}`}
						>
							{PERM_LABEL[p]}
						</span>
					{/each}
				</div>
			{/if}
		</div>

		<Button
			size="sm"
			variant="ghost"
			disabled={deleting || soleInstanceAdmin}
			onclick={onDelete}
			title={soleInstanceAdmin
				? 'Cannot delete the only instance admin. Promote another user first.'
				: 'Delete user'}
			class="h-8 w-8 shrink-0 p-0 text-destructive hover:text-destructive"
		>
			<Trash2 class="h-4 w-4" />
		</Button>
	</div>

	{#if expanded}
		<div class="mt-4 ml-10 space-y-4">
			{#if isPlatformAdmin}
				<section>
					<h4 class="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
						Platform
					</h4>
					<div class="grid gap-2 sm:grid-cols-2">
						{#each ALL_PLATFORM_PERMISSIONS as p (p)}
							{@const state = checkboxState(p)}
							<label
								class={`flex items-start gap-2 rounded-md border p-2.5 ${
									state.locked
										? 'cursor-not-allowed border-border opacity-60'
										: 'cursor-pointer border-border hover:bg-accent/40'
								}`}
								title={state.soleAdminLock
									? 'Cannot remove the only instance admin.'
									: undefined}
							>
								<input
									type="checkbox"
									class="mt-0.5 shrink-0"
									checked={state.checked}
									disabled={updating || state.locked}
									onchange={(e) =>
										onTogglePermission(p, (e.target as HTMLInputElement).checked)}
								/>
								<div class="min-w-0">
									<p class="text-sm font-medium leading-tight">{PERM_LABEL[p]}</p>
									<p class="mt-0.5 text-xs text-muted-foreground">{PERM_DESC[p]}</p>
								</div>
							</label>
						{/each}
					</div>
				</section>
			{/if}

			<section>
				<h4 class="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					Organization
				</h4>
				{#if isOwnerOrAdmin}
					<p class="text-sm text-muted-foreground">
						<strong class="text-foreground capitalize">{user.orgRole}s</strong> automatically receive
						all organization permissions. To grant a custom subset, change the role to
						<span class="font-mono">member</span>.
					</p>
				{:else}
					<div class="grid gap-2 sm:grid-cols-2">
						{#each ALL_ORG_PERMISSIONS as p (p)}
							{@const state = checkboxState(p)}
							<label
								class={`flex items-start gap-2 rounded-md border p-2.5 ${
									state.locked
										? 'cursor-not-allowed border-border opacity-60'
										: 'cursor-pointer border-border hover:bg-accent/40'
								}`}
								title={state.memberExcluded
									? 'Only owners and admins can hold this permission.'
									: undefined}
							>
								<input
									type="checkbox"
									class="mt-0.5 shrink-0"
									checked={state.checked}
									disabled={updating || state.locked}
									onchange={(e) =>
										onTogglePermission(p, (e.target as HTMLInputElement).checked)}
								/>
								<div class="min-w-0">
									<p class="text-sm font-medium leading-tight">{PERM_LABEL[p]}</p>
									<p class="mt-0.5 text-xs text-muted-foreground">{PERM_DESC[p]}</p>
								</div>
							</label>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</div>
