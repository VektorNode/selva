<script lang="ts">
	import { Button } from '@selvajs/ui';
	import { Ban, ChevronDown, ChevronRight, Trash2 } from '@lucide/svelte';
	import type { OrgPermission, PlatformPermission } from '@selvajs/platform';
	import { ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';
	import type { UserRow } from './+page.server';
	import UserRowIdentity from '$lib/components/UserRowIdentity.svelte';
	import {
		PERMISSION_LABELS as PERM_LABEL,
		PERMISSION_DESCRIPTIONS as PERM_DESC
	} from '$lib/permission-labels';

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

		<UserRowIdentity
			{user}
			id={user.id}
			role={user.orgRole}
			disabled={user.disabled}
			lastLoginAt={user.lastLoginAt}
		>
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
		</UserRowIdentity>

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
