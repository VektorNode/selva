<script lang="ts">
	import { Button } from '@selvajs/ui';
	import { Ban, ChevronDown, ChevronRight, Trash2 } from '@lucide/svelte';
	import type { OrgPermission, OrgRole, PlatformPermission } from '@selvajs/platform';
	import { ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';
	import type { UserRow } from './+page.server';
	import UserAvatar from '$lib/components/UserAvatar.svelte';

	type FlatPermission = PlatformPermission | OrgPermission;

	interface Props {
		user: UserRow;
		expanded: boolean;
		isPlatformAdmin: boolean;
		soleInstanceAdmin: boolean;
		updating: boolean;
		deleting: boolean;
		disabling: boolean;
		onToggleExpand: () => void;
		onTogglePermission: (perm: PlatformPermission, checked: boolean) => Promise<void>;
		onDelete: () => void;
		onDisable: () => void;
	}

	let {
		user,
		expanded,
		isPlatformAdmin,
		soleInstanceAdmin,
		updating,
		deleting,
		disabling,
		onToggleExpand,
		onTogglePermission,
		onDelete,
		onDisable
	}: Props = $props();

	const PERM_LABEL: Record<FlatPermission, string> = {
		instance_admin: 'Instance admin',
		manage_instance_users: 'Manage instance users',
		manage_compute: 'Manage compute',
		manage_updates: 'Manage updates',
		manage_org_members: 'Manage org members',
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
		manage_org_compute: "Configure this org's BYO compute server.",
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

	// Owners/admins hold every org permission implicitly, so listing them adds
	// nothing the role badge doesn't already say.
	const orgSummaryPerms = $derived<OrgPermission[]>(isOwnerOrAdmin ? [] : user.orgPermissions);

	// Deleting or disabling a platform admin is a platform-scope permission
	// change, so `manage_instance_users` alone does not authorize it — the server
	// refuses with 403 (requireCanRemoveInstanceAdmin). The checkboxes already
	// mirrored that rule via `platformLocked`; these buttons did not, so the page
	// offered a `manage_instance_users` holder a live Delete on every admin row.
	const targetIsPlatformAdmin = $derived(user.platformPermissions.includes('instance_admin'));
	const platformScopeLocked = $derived(targetIsPlatformAdmin && !isPlatformAdmin);

	const removalBlockReason = $derived(
		platformScopeLocked
			? 'Only a platform admin can remove another platform admin.'
			: soleInstanceAdmin
				? 'Cannot remove the only instance admin. Promote another user first.'
				: null
	);

	function checkboxState(perm: PlatformPermission) {
		const checked = user.platformPermissions.includes(perm);
		const platformLocked = !isPlatformAdmin;
		const soleAdminLock = perm === 'instance_admin' && soleInstanceAdmin;
		return { checked, locked: platformLocked || soleAdminLock, soleAdminLock, platformLocked };
	}
</script>

<div class={`px-4 py-3 ${expanded ? 'bg-accent/20' : ''}`}>
	<div class="flex items-center gap-3">
		<button
			type="button"
			class="text-muted-foreground hover:text-foreground shrink-0 rounded-sm p-0.5"
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
						class={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${ROLE_TONE[user.orgRole]}`}
					>
						{user.orgRole}
					</span>
				{/if}
				{#if user.disabled}
					<span
						class="border-border bg-muted text-muted-foreground rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase"
					>
						disabled
					</span>
				{:else if !user.lastLoginAt}
					<span
						class="rounded-full border border-amber-500/40 bg-amber-500/5 px-2 py-0.5 font-mono text-[10px] tracking-wide text-amber-600 uppercase dark:text-amber-400"
						title="Provisioned but has never signed in. Permissions take effect on first login."
					>
						never signed in
					</span>
				{/if}
			</div>
			<p class="text-muted-foreground truncate font-mono text-xs">{user.id}</p>
			{#if !expanded && (user.platformPermissions.length > 0 || orgSummaryPerms.length > 0)}
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each user.platformPermissions as p (p)}
						<span
							class="rounded-full bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-700 dark:text-amber-400"
						>
							{PERM_LABEL[p]}
						</span>
					{/each}
					{#each orgSummaryPerms as p (p)}
						<span
							class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-[10px]"
						>
							{PERM_LABEL[p]}
						</span>
					{/each}
				</div>
			{/if}
		</div>

		{#if !user.disabled}
			<Button
				size="sm"
				variant="ghost"
				disabled={disabling || !!removalBlockReason}
				onclick={onDisable}
				title={removalBlockReason ?? 'Disable user — they keep their history but cannot sign in'}
				class="text-muted-foreground hover:text-foreground h-8 w-8 shrink-0 p-0"
			>
				<Ban class="h-4 w-4" />
			</Button>
		{/if}

		<Button
			size="sm"
			variant="ghost"
			disabled={deleting || !!removalBlockReason}
			onclick={onDelete}
			title={removalBlockReason ?? 'Delete user'}
			class="text-destructive hover:text-destructive h-8 w-8 shrink-0 p-0"
		>
			<Trash2 class="h-4 w-4" />
		</Button>
	</div>

	{#if expanded}
		<div class="mt-4 ml-10 space-y-4">
			<section>
				<h4 class="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
					Platform
				</h4>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each ALL_PLATFORM_PERMISSIONS as p (p)}
						{@const state = checkboxState(p)}
						<label
							class={`flex items-start gap-2 rounded-md border p-2.5 ${
								state.locked
									? 'border-border cursor-not-allowed opacity-60'
									: 'border-border hover:bg-accent/40 cursor-pointer'
							}`}
							title={state.soleAdminLock ? 'Cannot remove the only instance admin.' : undefined}
						>
							<input
								type="checkbox"
								class="mt-0.5 shrink-0"
								checked={state.checked}
								disabled={updating || state.locked}
								onchange={(e) => onTogglePermission(p, (e.target as HTMLInputElement).checked)}
							/>
							<div class="min-w-0">
								<p class="text-sm leading-tight font-medium">{PERM_LABEL[p]}</p>
								<p class="text-muted-foreground mt-0.5 text-xs">{PERM_DESC[p]}</p>
							</div>
						</label>
					{/each}
				</div>
			</section>

			<section>
				<h4 class="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
					Organization
				</h4>
				{#if !user.orgRole}
					<p class="text-muted-foreground text-sm">Not a member of the active organization.</p>
				{:else}
					<p class="text-muted-foreground text-sm">
						{#if isOwnerOrAdmin}
							<strong class="text-foreground capitalize">{user.orgRole}s</strong> hold every organization
							permission.
						{:else if user.orgPermissions.length > 0}
							Member, holding {user.orgPermissions.map((p) => PERM_LABEL[p]).join(', ')}.
						{:else}
							Member, with no organization permissions granted.
						{/if}
					</p>
					<p class="text-muted-foreground mt-2 text-xs">
						Role and organization permissions are managed at
						<a href="/team/members" class="underline">Members &amp; roles</a>.
					</p>
				{/if}
			</section>
		</div>
	{/if}
</div>
