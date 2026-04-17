<script lang="ts">
	import { Button, Card, Input, toast } from 'selva-shared';
	import { Plus, Trash2, ShieldCheck } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { AuthUser, UserRole } from '@selva/platform/auth';

	interface PageData {
		users: AuthUser[] | null;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const ROLES: { value: UserRole; label: string }[] = [
		{ value: 'platform_admin', label: 'Admin' },
		{ value: 'user', label: 'User' }
	];

	// Add user form
	let showAddForm = $state(false);
	let newEmail = $state('');
	let newPassword = $state('');
	let newRole = $state<UserRole>('user');
	let adding = $state(false);

	// Per-user loading state
	let deletingId = $state<string | null>(null);
	let updatingRoleId = $state<string | null>(null);

	async function addUser() {
		adding = true;
		try {
			const res = await fetch('/admin/api/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email: newEmail, password: newPassword, role: newRole })
			});
			if (res.ok) {
				toast.success(`User "${newEmail}" created`);
				newEmail = '';
				newPassword = '';
				newRole = 'user';
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

	async function updateRole(id: string, role: UserRole) {
		updatingRoleId = id;
		try {
			const res = await fetch(`/admin/api/users/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role })
			});
			if (res.ok) {
				toast.success('Role updated');
				await invalidateAll();
			} else {
				toast.error('Failed to update role');
			}
		} catch {
			toast.error('Failed to update role');
		} finally {
			updatingRoleId = null;
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
				{#if data.users !== null}
					<Button onclick={() => (showAddForm = !showAddForm)} variant={showAddForm ? 'outline' : 'default'}>
						<Plus class="mr-2 h-4 w-4" />
						Add User
					</Button>
				{/if}
			</div>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Add user form -->
			{#if showAddForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">New User</p>
					<div class="grid gap-3 sm:grid-cols-3">
						<Input
							type="email"
							placeholder="Email"
							bind:value={newEmail}
							class="sm:col-span-1"
						/>
						<Input
							type="password"
							placeholder="Password (min 8 chars)"
							bind:value={newPassword}
							class="sm:col-span-1"
						/>
						<select
							bind:value={newRole}
							class="border-input bg-background rounded-md border px-3 py-2 text-sm"
						>
							{#each ROLES as role (role.value)}
								<option value={role.value}>{role.label}</option>
							{/each}
						</select>
					</div>
					<div class="flex gap-2">
						<Button onclick={addUser} disabled={adding || !newEmail || !newPassword}>
							{adding ? 'Creating…' : 'Create User'}
						</Button>
						<Button variant="outline" onclick={() => (showAddForm = false)}>Cancel</Button>
					</div>
				</div>
			{/if}

			<!-- User list -->
			{#if data.users === null}
				<div class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
					<ShieldCheck class="text-muted-foreground mb-3 h-8 w-8" />
					<p class="text-sm font-medium">Single-password mode active</p>
					<p class="text-muted-foreground mt-1 text-sm">
						Set a <code class="text-xs">usersFilePath</code> in your <code class="text-xs">selva.config.ts</code> to manage multiple users.
					</p>
				</div>
			{:else if data.users.length === 0}
				<div class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center">
					<p class="text-sm font-medium">No users yet</p>
					<p class="text-muted-foreground mt-1 text-sm">Add your first user above.</p>
				</div>
			{:else}
				<div class="divide-y rounded-lg border">
					{#each data.users as user (user.id)}
						<div class="flex items-center justify-between px-4 py-3">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{user.email ?? user.id}</p>
								<p class="text-muted-foreground text-xs">{user.id}</p>
							</div>
							<div class="ml-4 flex items-center gap-2">
								<select
									value={user.role}
									disabled={updatingRoleId === user.id}
									onchange={(e) => updateRole(user.id, (e.target as HTMLSelectElement).value as UserRole)}
									class="border-input bg-background rounded-md border px-2 py-1 text-xs disabled:opacity-50"
								>
									{#each ROLES as role (role.value)}
										<option value={role.value}>{role.label}</option>
									{/each}
								</select>
								<Button
									variant="ghost"
									size="sm"
									disabled={deletingId === user.id}
									onclick={() => deleteUser(user.id, user.email ?? user.id)}
									class="text-destructive hover:text-destructive h-8 w-8 p-0"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
