<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Plus, Trash2, ShieldCheck, Mail, Copy, X } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { AuthUser, Permission, Invite, OrgRole } from '@selva/platform';
	import { ALL_PERMISSIONS } from '@selva/platform';

	interface PageData {
		users: AuthUser[] | null;
		provider: {
			name: string;
			userCreation: 'email-password' | 'email-only' | 'none';
		};
		invites: Invite[];
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const PERMISSION_LABELS: Record<Permission, string> = {
		platform_admin: 'Platform Admin (all)',
		manage_users: 'Manage Users',
		manage_compute: 'Manage Compute',
		manage_definitions: 'Manage Definitions',
		manage_projects: 'Manage Projects'
	};

	const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

	// Add-user form state
	let showAddForm = $state(false);
	let newEmail = $state('');
	let newPassword = $state('');
	let newPermissions = $state<Permission[]>([]);
	let adding = $state(false);

	// Invite form state
	let showInviteForm = $state(false);
	let inviteEmail = $state('');
	let inviteRole = $state<OrgRole>('member');
	let invitePermissions = $state<Permission[]>([]);
	let creatingInvite = $state(false);
	let lastInviteLink = $state<string | null>(null);
	let revokingId = $state<string | null>(null);

	// Per-user loading state
	let deletingId = $state<string | null>(null);
	let updatingId = $state<string | null>(null);

	function toggleNewPermission(p: Permission, checked: boolean) {
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

	async function updatePermissions(id: string, permissions: Permission[]) {
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
				toast.error('Failed to update permissions');
			}
		} catch {
			toast.error('Failed to update permissions');
		} finally {
			updatingId = null;
		}
	}

	function toggleInvitePermission(p: Permission, checked: boolean) {
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

	async function copyInviteLink(token: string) {
		const url = `${window.location.origin}/accept-invite?token=${token}`;
		try {
			await navigator.clipboard.writeText(url);
			toast.success('Invite link copied');
		} catch {
			toast.error('Could not copy to clipboard');
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
				toast.error('Failed to delete user');
			}
		} catch {
			toast.error('Failed to delete user');
		} finally {
			deletingId = null;
		}
	}
</script>

<svelte:head>
	<title>Users - Selva Admin</title>
</svelte:head>

<div class="w-full space-y-6 px-6 py-6">
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>User Management</Card.Title>
					<Card.Description>
						{#if data.users === null}
							Single-password mode — configure a users.json path to enable multi-user management.
						{:else}
							{data.users.length} user{data.users.length === 1 ? '' : 's'}
						{/if}
					</Card.Description>
				</div>
				{#if data.users !== null && data.provider.userCreation !== 'none'}
					<div class="flex gap-2">
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
							{data.provider.userCreation === 'email-only' ? 'Allowlist User' : 'Add User'}
						</Button>
					</div>
				{/if}
			</div>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Invite-user form -->
			{#if showInviteForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">Invite user</p>
					<p class="text-muted-foreground text-xs">
						The invitee sets their own password when they open the link. No password leaves
						your machine.
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
						<p class="mb-2 text-xs font-medium">Platform permissions</p>
						<div class="flex flex-wrap gap-3">
							{#each ALL_PERMISSIONS as p (p)}
								<label class="flex cursor-pointer items-center gap-1.5 text-xs">
									<input
										type="checkbox"
										checked={invitePermissions.includes(p)}
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
				<div class="flex items-start gap-3 rounded-lg border border-green-500/30 bg-green-500/5 p-4">
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
							<Input type="password" placeholder="Password (min 8 chars)" bind:value={newPassword} />
						{/if}
					</div>
					{#if data.provider.userCreation === 'email-only'}
						<p class="text-muted-foreground text-xs">
							This user will authenticate via {data.provider.name}. No password is stored.
						</p>
					{/if}
					<div>
						<p class="mb-2 text-xs font-medium">Permissions</p>
						<div class="flex flex-wrap gap-3">
							{#each ALL_PERMISSIONS as p (p)}
								<label class="flex cursor-pointer items-center gap-1.5 text-xs">
									<input
										type="checkbox"
										checked={newPermissions.includes(p)}
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
							disabled={adding || !newEmail || (data.provider.userCreation === 'email-password' && !newPassword)}
						>
							{adding ? 'Creating…' : 'Create User'}
						</Button>
						<Button variant="outline" onclick={() => (showAddForm = false)}>Cancel</Button>
					</div>
				</div>
			{/if}

			<!-- User list -->
			{#if data.users === null}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<ShieldCheck class="text-muted-foreground mb-3 h-8 w-8" />
					<p class="text-sm font-medium">Single-password mode active</p>
					<p class="text-muted-foreground mt-1 text-sm">
						Set a <code class="text-xs">usersFilePath</code> in your
						<code class="text-xs">selva.config.ts</code> to manage multiple users.
					</p>
				</div>
			{:else if data.users.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<p class="text-sm font-medium">No users yet</p>
					<p class="text-muted-foreground mt-1 text-sm">Add your first user above.</p>
				</div>
			{:else}
				<div class="divide-y rounded-lg border">
					{#each data.users as user (user.id)}
						<div class="px-4 py-3">
							<div class="flex items-start justify-between gap-4">
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{user.email ?? user.id}</p>
									<p class="text-muted-foreground text-xs">{user.id}</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									disabled={deletingId === user.id}
									onclick={() => deleteUser(user.id, user.email ?? user.id)}
									class="text-destructive hover:text-destructive h-8 w-8 shrink-0 p-0"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
							<div class="mt-2 flex flex-wrap gap-3">
								{#each ALL_PERMISSIONS as p (p)}
									<label class="flex cursor-pointer items-center gap-1.5 text-xs">
										<input
											type="checkbox"
											checked={user.permissions.includes(p)}
											disabled={updatingId === user.id}
											onchange={async (e) => {
												const checked = (e.target as HTMLInputElement).checked;
												const next = checked
													? [...user.permissions, p]
													: user.permissions.filter((x) => x !== p);
												await updatePermissions(user.id, next);
											}}
										/>
										{PERMISSION_LABELS[p]}
									</label>
								{/each}
							</div>
						</div>
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
						{@const status = invite.acceptedAt
							? 'Accepted'
							: expired
								? 'Expired'
								: 'Pending'}
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
									variant="outline"
									onclick={() => copyInviteLink(invite.token)}
								>
									<Copy class="mr-1.5 h-3.5 w-3.5" />
									Copy link
								</Button>
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
