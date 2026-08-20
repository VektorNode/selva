<script lang="ts">
	import { Button, Card, EmptyState, Input, toast, SectionHeader } from '@selvajs/ui';
	import { Plus, ShieldCheck, X, Search, Mail } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { OrgRole, PlatformPermission } from '@selvajs/platform';
	import { ALL_PLATFORM_PERMISSIONS } from '@selvajs/platform';
	import type { UserRow } from './+page.server';
	import UserListItem from './UserListItem.svelte';

	interface PageData {
		users: UserRow[] | null;
		provider: {
			name: string;
			userCreation: 'email-password' | 'email-only' | 'none';
		};
		isPlatformAdmin: boolean;
		/** Instance-wide, not page-derived. `null` when the count failed. */
		enabledInstanceAdminCount: number | null;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	// Platform scope only — org role and permissions are edited at /team/members,
	// which gates on manage_org_members. This page holds manage_instance_users,
	// which says nothing about any one org.
	const assignablePermissions = $derived<PlatformPermission[]>(
		data.isPlatformAdmin ? [...ALL_PLATFORM_PERMISSIONS] : []
	);

	// Same wording as UserListItem's PERM_LABEL — the two render side by side
	// (filter dropdown and row detail), so a casing split reads as two vocabularies.
	const PERMISSION_LABELS: Record<PlatformPermission, string> = {
		instance_admin: 'Instance admin',
		manage_instance_users: 'Manage instance users',
		manage_compute: 'Manage compute',
		manage_updates: 'Manage updates'
	};

	const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'member'];

	// Allowlist-user form state
	let showAddForm = $state(false);
	let newEmail = $state('');
	let newPermissions = $state<PlatformPermission[]>([]);
	let adding = $state(false);

	// Per-user loading state
	let deletingId = $state<string | null>(null);
	let disablingId = $state<string | null>(null);
	let updatingId = $state<string | null>(null);
	let expandedUserId = $state<string | null>(null);

	// Filter state — client-side over the loaded page (listUsers caps at 200).
	let query = $state('');
	let roleFilter = $state<OrgRole | 'all'>('all');
	let permissionFilter = $state<PlatformPermission | 'all'>('all');
	let statusFilter = $state<'all' | 'enabled' | 'disabled' | 'never-signed-in'>('all');

	const filtersActive = $derived(
		query.trim() !== '' ||
			roleFilter !== 'all' ||
			permissionFilter !== 'all' ||
			statusFilter !== 'all'
	);

	function matchesQuery(user: UserRow, needle: string) {
		return [user.displayName, user.email, user.id].some((field) =>
			field?.toLowerCase().includes(needle)
		);
	}

	function matchesStatus(user: UserRow) {
		switch (statusFilter) {
			case 'enabled':
				return !user.disabled;
			case 'disabled':
				return !!user.disabled;
			case 'never-signed-in':
				return !user.lastLoginAt;
			default:
				return true;
		}
	}

	const visibleUsers = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return (data.users ?? []).filter(
			(user) =>
				(needle === '' || matchesQuery(user, needle)) &&
				(roleFilter === 'all' || user.orgRole === roleFilter) &&
				(permissionFilter === 'all' || user.platformPermissions.includes(permissionFilter)) &&
				matchesStatus(user)
		);
	});

	function clearFilters() {
		query = '';
		roleFilter = 'all';
		permissionFilter = 'all';
		statusFilter = 'all';
	}

	// docs/contributing/permissions.md §2 invariant mirror: if only one enabled user holds
	// instance_admin, lock the checkbox and destructive buttons on that row. The
	// server enforces the same; this is the UX nudge.
	//
	// The count comes from the loader, which asks the permission store over every
	// row. Counting the loaded page instead would lock the wrong rows once an
	// instance outgrows 200 users.
	const isSoleInstanceAdmin = (user: UserRow) =>
		data.enabledInstanceAdminCount === 1 &&
		!user.disabled &&
		user.platformPermissions.includes('instance_admin');

	function toggleNewPermission(p: PlatformPermission, checked: boolean) {
		if (checked) {
			newPermissions = [...newPermissions, p];
		} else {
			newPermissions = newPermissions.filter((x) => x !== p);
		}
	}

	async function addUser() {
		adding = true;
		try {
			const res = await fetch('/api/admin/users', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					email: newEmail,
					permissions: newPermissions
				})
			});
			if (res.ok) {
				toast.success(`${newEmail} can now sign in via ${data.provider.name}`);
				newEmail = '';
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

	async function updatePermissions(id: string, permissions: PlatformPermission[]) {
		updatingId = id;
		try {
			const res = await fetch(`/api/admin/users/${id}`, {
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

	// One-way door: there is no enable endpoint, so the confirmation says so
	// rather than letting an admin discover it afterwards.
	async function disableUser(id: string, email: string) {
		if (
			!confirm(
				`Disable "${email}"? They keep their identity and history but cannot sign in. There is no way to re-enable them from this page.`
			)
		)
			return;
		disablingId = id;
		try {
			const res = await fetch(`/api/admin/users/${id}/disable`, { method: 'POST' });
			if (res.ok) {
				toast.success(`User "${email}" disabled`);
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to disable user');
			}
		} catch {
			toast.error('Failed to disable user');
		} finally {
			disablingId = null;
		}
	}

	async function deleteUser(id: string, email: string) {
		if (!confirm(`Delete user "${email}"? This cannot be undone.`)) return;
		deletingId = id;
		try {
			const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
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
			{#if data.users !== null}
				{#if data.provider.userCreation === 'email-only'}
					<Button
						onclick={() => (showAddForm = !showAddForm)}
						variant={showAddForm ? 'outline' : 'default'}
					>
						<Plus class="mr-2 h-4 w-4" />
						Allowlist user
					</Button>
				{:else}
					<Button href="/team/members" variant="default">
						<Mail class="mr-2 h-4 w-4" />
						Invite member
					</Button>
				{/if}
			{/if}
		{/snippet}
	</SectionHeader>

	<Card.Root>
		<Card.Content class="space-y-4 pt-6">
			<!-- Add user form -->
			{#if showAddForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">New User</p>
					<Input type="email" placeholder="Email" bind:value={newEmail} />
					<p class="text-muted-foreground text-xs">
						This user will authenticate via {data.provider.name}. No password is stored.
					</p>
					{#if data.isPlatformAdmin}
						<div>
							<p class="mb-2 text-xs font-medium">Instance permissions</p>
							<p class="text-muted-foreground mb-2 text-xs">
								Apply across the whole instance. The user joins the active organization as a
								<span class="font-mono">member</span>; grant them access there from
								<a href="/team/members" class="underline">Members &amp; roles</a>.
							</p>
							<div class="flex flex-wrap gap-3">
								{#each assignablePermissions as p (p)}
									<label class="flex cursor-pointer items-center gap-1.5 text-xs">
										<input
											type="checkbox"
											checked={newPermissions.includes(p)}
											onchange={(e) =>
												toggleNewPermission(p, (e.target as HTMLInputElement).checked)}
										/>
										{PERMISSION_LABELS[p]}
									</label>
								{/each}
							</div>
						</div>
					{:else}
						<p class="text-muted-foreground text-xs">
							The user joins the active organization as a <span class="font-mono">member</span>.
							Grant them access from
							<a href="/team/members" class="underline">Members &amp; roles</a>.
						</p>
					{/if}
					<div class="flex gap-2">
						<Button onclick={addUser} disabled={adding || !newEmail}>
							{adding ? 'Adding…' : 'Allowlist user'}
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
						selection in <code class="text-xs">.env</code>.
					{/snippet}
				</EmptyState>
			{:else if data.users.length === 0}
				<EmptyState title="No users yet" description="Add your first user above." />
			{:else}
				<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
					<div class="relative flex-1">
						<Search
							class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
						/>
						<Input
							type="search"
							placeholder="Search name, email, or ID"
							bind:value={query}
							class="pl-9"
						/>
					</div>
					<select
						bind:value={roleFilter}
						aria-label="Filter by role in the active organization"
						class="border-input bg-background h-9 rounded-md border px-3 text-sm"
					>
						<option value="all">All org roles</option>
						{#each ORG_ROLES as role (role)}
							<option value={role}>{role}</option>
						{/each}
					</select>
					<select
						bind:value={permissionFilter}
						aria-label="Filter by instance permission"
						class="border-input bg-background h-9 rounded-md border px-3 text-sm"
					>
						<option value="all">All instance permissions</option>
						{#each assignablePermissions as p (p)}
							<option value={p}>{PERMISSION_LABELS[p]}</option>
						{/each}
					</select>
					<select
						bind:value={statusFilter}
						aria-label="Filter by status"
						class="border-input bg-background h-9 rounded-md border px-3 text-sm"
					>
						<option value="all">Any status</option>
						<option value="enabled">Enabled</option>
						<option value="disabled">Disabled</option>
						<option value="never-signed-in">Never signed in</option>
					</select>
					{#if filtersActive}
						<Button variant="ghost" size="sm" onclick={clearFilters}>
							<X class="mr-1.5 h-3.5 w-3.5" />
							Clear
						</Button>
					{/if}
				</div>

				{#if filtersActive}
					<p class="text-muted-foreground text-xs">
						{visibleUsers.length} of {data.users.length} users
					</p>
				{/if}

				{#if visibleUsers.length === 0}
					<EmptyState title="No matching users" description="Adjust or clear the filters above." />
				{:else}
					<div class="divide-y rounded-lg border">
						{#each visibleUsers as user (user.id)}
							<UserListItem
								{user}
								expanded={expandedUserId === user.id}
								isPlatformAdmin={data.isPlatformAdmin}
								soleInstanceAdmin={isSoleInstanceAdmin(user)}
								updating={updatingId === user.id}
								deleting={deletingId === user.id}
								disabling={disablingId === user.id}
								onToggleExpand={() =>
									(expandedUserId = expandedUserId === user.id ? null : user.id)}
								onTogglePermission={async (perm, checked) => {
									const next = checked
										? [...user.platformPermissions, perm]
										: user.platformPermissions.filter((x) => x !== perm);
									await updatePermissions(user.id, next);
								}}
								onDelete={() => deleteUser(user.id, user.email ?? user.id)}
								onDisable={() => disableUser(user.id, user.email ?? user.id)}
							/>
						{/each}
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
