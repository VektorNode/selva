<script lang="ts">
	import { Button, Card, EmptyState, Input, toast, SectionHeader } from '@selvajs/ui';
	import { Plus, Trash2, ShieldCheck, Mail, Copy, X } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { Invite, OrgPermission, OrgRole, PlatformPermission } from '@selvajs/platform';
	import {
		ALL_ORG_PERMISSIONS,
		ALL_PLATFORM_PERMISSIONS,
		OWNER_ADMIN_ONLY_PERMISSIONS
	} from '@selvajs/platform';
	import type { UserRow } from './+page.server';
	import UserListItem from './UserListItem.svelte';

	// One flat list today; scoped Platform-admin + Org-member views come later.
	type FlatPermission = PlatformPermission | OrgPermission;
	const ALL_FLAT_PERMISSIONS: FlatPermission[] = [
		...ALL_PLATFORM_PERMISSIONS,
		...ALL_ORG_PERMISSIONS
	];

	interface PageData {
		users: UserRow[] | null;
		provider: {
			name: string;
			userCreation: 'email-password' | 'email-only' | 'none';
		};
		invites: Invite[];
		isPlatformAdmin: boolean;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	// Platform-scope checkboxes are hidden for non-platform-admins — the server
	// rejects them anyway. Invites never carry platform perms (invite API drops
	// them), so the invite form always shows the org-only list.
	const assignablePermissions = $derived<FlatPermission[]>(
		data.isPlatformAdmin ? ALL_FLAT_PERMISSIONS : [...ALL_ORG_PERMISSIONS]
	);

	const PERMISSION_LABELS: Record<FlatPermission, string> = {
		instance_admin: 'Instance Admin (all)',
		manage_instance_users: 'Manage Instance Users',
		manage_compute: 'Manage Compute (instance)',
		manage_updates: 'Manage Updates',
		manage_org_members: 'Manage Org Members',
		manage_org_compute: 'Manage Org Compute',
		manage_definitions: 'Manage Definitions',
		manage_projects: 'Manage Projects'
	};

	const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

	// Add-user form state
	let showAddForm = $state(false);
	let newEmail = $state('');
	let newPassword = $state('');
	let newPermissions = $state<FlatPermission[]>([]);
	let adding = $state(false);

	// Invite form state
	let showInviteForm = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<OrgRole>('member');
	let invitePermissions = $state<FlatPermission[]>([]);
	let creatingInvite = $state(false);
	let lastInviteLink = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	// For members, hide owner/admin-only permissions entirely — they're never
	// grantable to a member. Owners/admins see the whole list (all boxes are
	// implicitly checked in the template).
	const invitePermissionOptions = $derived<FlatPermission[]>(
		inviteRole === 'member'
			? ALL_ORG_PERMISSIONS.filter(
					(p) => !(OWNER_ADMIN_ONLY_PERMISSIONS as readonly OrgPermission[]).includes(p)
				)
			: [...ALL_ORG_PERMISSIONS]
	);

	// Per-user loading state
	let deletingId = $state<string | null>(null);
	let updatingId = $state<string | null>(null);
	let expandedUserId = $state<string | null>(null);

	// Permissions.md §2 invariant mirror: if only one enabled user holds
	// instance_admin, lock the checkbox and delete button on that row. The
	// server enforces the same; this is the UX nudge.
	const enabledInstanceAdminCount = $derived(
		(data.users ?? []).filter(
			(u) => !u.disabled && u.platformPermissions.includes('instance_admin')
		).length
	);
	const isSoleInstanceAdmin = (user: UserRow) =>
		enabledInstanceAdminCount === 1 &&
		!user.disabled &&
		user.platformPermissions.includes('instance_admin');

	function toggleNewPermission(p: FlatPermission, checked: boolean) {
		if (checked) {
			newPermissions = [...newPermissions, p];
		} else {
			newPermissions = newPermissions.filter((x) => x !== p);
		}
	}

	async function addUser() {
		adding = true;
		try {
			const res = await fetch('/admin/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: newEmail,
					...(data.provider.userCreation === 'email-password' && { password: newPassword }),
					permissions: newPermissions
				})
			});
			if (res.ok) {
				toast.success(`User "${newEmail}" created`);
				newEmail = '';
				newPassword = '';
				newPermissions = [];
				showAddForm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				toast.error(err.message || err.error || 'Failed to create user');
			}
		} catch {
			toast.error('Failed to create user');
		} finally {
			adding = false;
		}
	}

	async function updatePermissions(id: string, permissions: FlatPermission[]) {
		updatingId = id;
		try {
			const res = await fetch(`/admin/api/users/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ permissions })
			});
			if (res.ok) {
				toast.success('Permissions updated');
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to update permissions');
				await invalidateAll();
			}
		} catch {
			toast.error('Failed to update permissions');
		} finally {
			updatingId = null;
		}
	}

	function toggleInvitePermission(p: FlatPermission, checked: boolean) {
		if (checked) {
			invitePermissions = [...invitePermissions, p];
		} else {
			invitePermissions = invitePermissions.filter((x) => x !== p);
		}
	}

	async function createInvite() {
		creatingInvite = true;
		try {
			const res = await fetch('/api/invites', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: inviteEmail,
					orgRole: inviteRole,
					permissions: invitePermissions
				})
			});
			if (res.ok) {
				const { acceptUrl } = (await res.json()) as { acceptUrl: string };
				lastInviteLink = acceptUrl;
				toast.success(`Invite created for ${inviteEmail}`);
				inviteEmail = '';
				inviteRole = 'member';
				invitePermissions = [];
				showInviteForm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({ error: 'Unknown error' }));
				toast.error(err.message || err.error || 'Failed to create invite');
			}
		} catch {
			toast.error('Failed to create invite');
		} finally {
			creatingInvite = false;
		}
	}

	async function revokeInvite(id: string, email: string) {
		if (!confirm(`Revoke invite for "${email}"?`)) return;
		revokingId = id;
		try {
			const res = await fetch(`/api/invites/${id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success('Invite revoked');
				await invalidateAll();
			} else {
				toast.error('Failed to revoke invite');
			}
		} catch {
			toast.error('Failed to revoke invite');
		} finally {
			revokingId = null;
		}
	}

	async function deleteUser(id: string, email: string) {
		if (!confirm(`Delete user "${email}"? This cannot be undone.`)) return;
		deletingId = id;
		try {
			const res = await fetch(`/admin/api/users/${id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success(`User "${email}" deleted`);
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to delete user');
			}
		} catch {
			toast.error('Failed to delete user');
		} finally {
			deletingId = null;
		}
	}
</script>

<svelte:head>
	<title>Admin · Users</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Admin"
		title="Users"
		description={data.users === null
			? 'The current auth provider does not expose a user store. Configure DATA_PATH (local provider) or check your provider wiring.'
			: `${data.users.length} user${data.users.length === 1 ? '' : 's'} on this instance.`}
	>
		{#snippet actions()}
			{#if data.users !== null && data.provider.userCreation !== 'none'}
				{#if data.provider.userCreation === 'email-password'}
					<Button
						onclick={() => {
							showInviteForm = !showInviteForm;
							if (showInviteForm) showAddForm = false;
						}}
						variant={showInviteForm ? 'outline' : 'default'}
					>
						<Mail class="mr-2 h-4 w-4" />
						Invite user
					</Button>
				{/if}
				<Button
					onclick={() => {
						showAddForm = !showAddForm;
						if (showAddForm) showInviteForm = false;
					}}
					variant={showAddForm ? 'outline' : 'secondary'}
				>
					<Plus class="mr-2 h-4 w-4" />
					{data.provider.userCreation === 'email-only' ? 'Allowlist user' : 'Add user'}
				</Button>
			{/if}
		{/snippet}
	</SectionHeader>

	<Card.Root>
		<Card.Content class="space-y-4 pt-6">
			<!-- Invite-user form -->
			{#if showInviteForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">Invite user</p>
					<p class="text-muted-foreground text-xs">
						The invitee sets their own password when they open the link. No password leaves your
						machine.
					</p>
					<div class="grid gap-3 sm:grid-cols-2">
						<Input type="email" placeholder="Email" bind:value={inviteEmail} />
						<select
							bind:value={inviteRole}
							class="border-input bg-background h-9 rounded-md border px-3 text-sm"
						>
							{#each ORG_ROLES as role (role)}
								<option value={role}>{role}</option>
							{/each}
						</select>
					</div>
					<div>
						<p class="mb-2 text-xs font-medium">Organization permissions</p>
						{#if inviteRole !== 'member'}
							<p class="text-muted-foreground mb-2 text-xs">
								{inviteRole === 'owner' ? 'Owners' : 'Admins'} automatically receive all organization
								permissions. Pick <span class="font-mono">member</span> to grant a custom subset.
							</p>
						{/if}
						<div class="flex flex-wrap gap-3">
							{#each invitePermissionOptions as p (p)}
								{@const roleLocked = inviteRole !== 'member'}
								<label
									class="flex items-center gap-1.5 text-xs {roleLocked
										? 'cursor-not-allowed opacity-60'
										: 'cursor-pointer'}"
								>
									<input
										type="checkbox"
										checked={roleLocked || invitePermissions.includes(p)}
										disabled={roleLocked}
										onchange={(e) =>
											toggleInvitePermission(p, (e.target as HTMLInputElement).checked)}
									/>
									{PERMISSION_LABELS[p]}
								</label>
							{/each}
						</div>
					</div>
					<div class="flex gap-2">
						<Button onclick={createInvite} disabled={creatingInvite || !inviteEmail}>
							{creatingInvite ? 'Creating…' : 'Create invite'}
						</Button>
						<Button variant="outline" onclick={() => (showInviteForm = false)}>Cancel</Button>
					</div>
				</div>
			{/if}

			{#if lastInviteLink}
				<div
					class="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4"
				>
					<div class="min-w-0 flex-1">
						<p class="text-sm font-medium">Invite ready — copy the link and share it</p>
						<p class="text-muted-foreground mt-1 truncate font-mono text-xs">{lastInviteLink}</p>
					</div>
					<Button
						size="sm"
						variant="outline"
						onclick={async () => {
							try {
								await navigator.clipboard.writeText(lastInviteLink!);
								toast.success('Invite link copied');
							} catch {
								toast.error('Could not copy to clipboard');
							}
						}}
					>
						<Copy class="mr-1.5 h-3.5 w-3.5" />
						Copy
					</Button>
					<Button size="sm" variant="ghost" onclick={() => (lastInviteLink = null)}>
						<X class="h-4 w-4" />
					</Button>
				</div>
			{/if}

			<!-- Add user form -->
			{#if showAddForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">New User</p>
					<div class="grid gap-3 sm:grid-cols-2">
						<Input type="email" placeholder="Email" bind:value={newEmail} />
						{#if data.provider.userCreation === 'email-password'}
							<Input
								type="password"
								placeholder="Password (min 8 chars)"
								bind:value={newPassword}
							/>
						{/if}
					</div>
					{#if data.provider.userCreation === 'email-only'}
						<p class="text-muted-foreground text-xs">
							This user will authenticate via {data.provider.name}. No password is stored.
						</p>
					{/if}
					<div>
						<p class="mb-2 text-xs font-medium">Permissions</p>
						<p class="text-muted-foreground mb-2 text-xs">
							New users are added as <span class="font-mono">member</span>. Promote them to owner or
							admin from the user list to grant full organization access.
						</p>
						<div class="flex flex-wrap gap-3">
							{#each assignablePermissions as p (p)}
								{@const isOwnerAdminOnly = (
									OWNER_ADMIN_ONLY_PERMISSIONS as readonly FlatPermission[]
								).includes(p)}
								{@const isPlatformScope = (
									ALL_PLATFORM_PERMISSIONS as readonly FlatPermission[]
								).includes(p)}
								{@const memberExcluded = isOwnerAdminOnly && !isPlatformScope}
								<label
									class="flex items-center gap-1.5 text-xs {memberExcluded
										? 'cursor-not-allowed opacity-60'
										: 'cursor-pointer'}"
									title={memberExcluded
										? 'Only owners and admins can hold this permission'
										: undefined}
								>
									<input
										type="checkbox"
										checked={!memberExcluded && newPermissions.includes(p)}
										disabled={memberExcluded}
										onchange={(e) => toggleNewPermission(p, (e.target as HTMLInputElement).checked)}
									/>
									{PERMISSION_LABELS[p]}
								</label>
							{/each}
						</div>
					</div>
					<div class="flex gap-2">
						<Button
							onclick={addUser}
							disabled={adding ||
								!newEmail ||
								(data.provider.userCreation === 'email-password' && !newPassword)}
						>
							{adding ? 'Creating…' : 'Create User'}
						</Button>
						<Button variant="outline" onclick={() => (showAddForm = false)}>Cancel</Button>
					</div>
				</div>
			{/if}

			<!-- User list -->
			{#if data.users === null}
				<EmptyState icon={ShieldCheck} title="User store unavailable">
					{#snippet body()}
						Set <code class="text-xs">DATA_PATH</code> (local provider) or check your provider
						wiring in <code class="text-xs">selva.config.ts</code>.
					{/snippet}
				</EmptyState>
			{:else if data.users.length === 0}
				<EmptyState title="No users yet" description="Add your first user above." />
			{:else}
				<div class="divide-y rounded-lg border">
					{#each data.users as user (user.id)}
						<UserListItem
							{user}
							expanded={expandedUserId === user.id}
							isPlatformAdmin={data.isPlatformAdmin}
							soleInstanceAdmin={isSoleInstanceAdmin(user)}
							updating={updatingId === user.id}
							deleting={deletingId === user.id}
							onToggleExpand={() => (expandedUserId = expandedUserId === user.id ? null : user.id)}
							onTogglePermission={async (perm, checked) => {
								const next = checked
									? [...user.permissions, perm]
									: user.permissions.filter((x) => x !== perm);
								await updatePermissions(user.id, next);
							}}
							onDelete={() => deleteUser(user.id, user.email ?? user.id)}
						/>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if data.invites.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>Invites</Card.Title>
				<Card.Description>
					{data.invites.filter((i) => !i.acceptedAt).length} pending, {data.invites.filter(
						(i) => i.acceptedAt
					).length} accepted
				</Card.Description>
			</Card.Header>
			<Card.Content>
				<div class="divide-y rounded-lg border">
					{#each data.invites as invite (invite.id)}
						{@const expired = Date.parse(invite.expiresAt) <= Date.now()}
						{@const status = invite.acceptedAt ? 'Accepted' : expired ? 'Expired' : 'Pending'}
						<div class="flex items-center justify-between gap-4 px-4 py-3">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{invite.email}</p>
								<p class="text-muted-foreground text-xs">
									{status} · {invite.orgRole} · expires {new Date(
										invite.expiresAt
									).toLocaleDateString()}
								</p>
							</div>
							{#if !invite.acceptedAt && !expired}
								<Button
									size="sm"
									variant="ghost"
									disabled={revokingId === invite.id}
									onclick={() => revokeInvite(invite.id, invite.email)}
									class="text-destructive hover:text-destructive"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							{/if}
						</div>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}
</div>
