<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Plus, Trash2, ShieldCheck } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { AuthUser, Permission, AuthProviderCapabilities } from '@selva/platform/auth';
	import { ALL_PERMISSIONS } from '@selva/platform/auth';

	interface PageData {
		users: AuthUser[] | null;
		capabilities: AuthProviderCapabilities;
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

	// Add user form
	let showAddForm = $state(false);
	let newEmail = $state('');
	let newPassword = $state('');
	let newPermissions = $state<Permission[]>([]);
	let adding = $state(false);

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
					...(data.capabilities.userCreation === 'email-password' && { password: newPassword }),
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

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
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
				{#if data.users !== null && data.capabilities.userCreation !== 'none'}
					<Button
						onclick={() => (showAddForm = !showAddForm)}
						variant={showAddForm ? 'outline' : 'default'}
					>
						<Plus class="mr-2 h-4 w-4" />
						{data.capabilities.userCreation === 'email-only' ? 'Allowlist User' : 'Add User'}
					</Button>
				{/if}
			</div>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Add user form -->
			{#if showAddForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">New User</p>
					<div class="grid gap-3 sm:grid-cols-2">
						<Input type="email" placeholder="Email" bind:value={newEmail} />
						{#if data.capabilities.userCreation === 'email-password'}
							<Input type="password" placeholder="Password (min 8 chars)" bind:value={newPassword} />
						{/if}
					</div>
					{#if data.capabilities.userCreation === 'email-only'}
						<p class="text-muted-foreground text-xs">
							This user will authenticate via {data.capabilities.name}. No password is stored.
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
							disabled={adding || !newEmail || (data.capabilities.userCreation === 'email-password' && !newPassword)}
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
</div>
