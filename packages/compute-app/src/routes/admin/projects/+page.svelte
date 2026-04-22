<script lang="ts">
	import { Button, Card, Input, Label, Textarea, Badge, toast, AlertDialog } from 'selva-shared';
	import { Plus, Trash2, UserPlus, X } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ProjectWithMembers, AuthUser } from './+page.server.js';
	import type { ProjectRole, ProjectVisibility } from '@selva/platform/projects';

	interface PageData {
		projects: ProjectWithMembers[];
		users: AuthUser[];
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	const ROLES: { value: ProjectRole; label: string }[] = [
		{ value: 'owner', label: 'Owner' },
		{ value: 'editor', label: 'Editor' },
		{ value: 'viewer', label: 'Viewer' }
	];

	const VISIBILITY: { value: ProjectVisibility; label: string; description: string; uploadNote?: string }[] = [
		{
			value: 'public',
			label: 'Public',
			description: 'Any authenticated user can solve',
			uploadNote: 'Any user with manage_definitions can upload (no membership needed)'
		},
		{
			value: 'org',
			label: 'Org',
			description: 'Any org member can solve',
			uploadNote: 'Any org member with manage_definitions can upload (no membership needed)'
		},
		{
			value: 'private',
			label: 'Private',
			description: 'Only project members can solve',
			uploadNote: 'Must be a project member to upload'
		}
	];

	// New project form
	let showAddForm = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newVisibility = $state<ProjectVisibility>('public');
	let adding = $state(false);

	// Per-project edit state
	let editingId = $state<string | null>(null);
	let editName = $state('');
	let editDescription = $state('');
	let editVisibility = $state<ProjectVisibility>('public');
	let saving = $state(false);

	// Member management
	let addMemberProjectId = $state<string | null>(null);
	let newMemberUserId = $state('');
	let newMemberRole = $state<ProjectRole>('viewer');
	let addingMember = $state(false);

	// Delete confirm
	let deletingProjectId = $state<string | null>(null);
	let removingMember = $state<string | null>(null);

	function startEdit(project: ProjectWithMembers) {
		editingId = project.id;
		editName = project.name;
		editDescription = project.description ?? '';
		editVisibility = project.visibility;
	}

	function cancelEdit() {
		editingId = null;
	}

	function userLabel(userId: string): string {
		const u = data.users.find((u) => u.id === userId);
		return u?.email ?? userId;
	}

	async function addProject() {
		if (!newName.trim()) return;
		adding = true;
		try {
			const res = await fetch('/admin/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({
					name: newName,
					description: newDescription,
					visibility: newVisibility
				})
			});
			if (res.ok) {
				toast.success(`Project "${newName}" created`);
				newName = '';
				newDescription = '';
				newVisibility = 'public';
				showAddForm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || 'Failed to create project');
			}
		} catch {
			toast.error('Failed to create project');
		} finally {
			adding = false;
		}
	}

	async function saveProject(id: string) {
		saving = true;
		try {
			const res = await fetch(`/admin/api/projects/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({
					name: editName,
					description: editDescription,
					visibility: editVisibility
				})
			});
			if (res.ok) {
				toast.success('Project saved');
				editingId = null;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || 'Failed to save project');
			}
		} catch {
			toast.error('Failed to save project');
		} finally {
			saving = false;
		}
	}

	async function deleteProject(id: string) {
		try {
			const res = await fetch(`/admin/api/projects/${id}`, {
				method: 'DELETE',
				headers: { Accept: 'application/json' }
			});
			if (res.ok) {
				toast.success('Project deleted');
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || 'Failed to delete project');
			}
		} catch {
			toast.error('Failed to delete project');
		} finally {
			deletingProjectId = null;
		}
	}

	async function addMember(projectId: string) {
		if (!newMemberUserId) return;
		addingMember = true;
		try {
			const res = await fetch(`/admin/api/projects/${projectId}/members`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ userId: newMemberUserId, role: newMemberRole })
			});
			if (res.ok) {
				toast.success('Member added');
				newMemberUserId = '';
				newMemberRole = 'viewer';
				addMemberProjectId = null;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || 'Failed to add member');
			}
		} catch {
			toast.error('Failed to add member');
		} finally {
			addingMember = false;
		}
	}

	async function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
		try {
			const res = await fetch(`/admin/api/projects/${projectId}/members/${userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ role })
			});
			if (res.ok) {
				await invalidateAll();
			} else {
				toast.error('Failed to update role');
			}
		} catch {
			toast.error('Failed to update role');
		}
	}

	async function removeMember(projectId: string, userId: string) {
		removingMember = `${projectId}:${userId}`;
		try {
			const res = await fetch(`/admin/api/projects/${projectId}/members/${userId}`, {
				method: 'DELETE',
				headers: { Accept: 'application/json' }
			});
			if (res.ok) {
				await invalidateAll();
			} else {
				toast.error('Failed to remove member');
			}
		} catch {
			toast.error('Failed to remove member');
		} finally {
			removingMember = null;
		}
	}

	// Users not yet in a given project
	function availableUsers(project: ProjectWithMembers): AuthUser[] {
		const memberIds = new Set(project.members.map((m) => m.userId));
		return data.users.filter((u) => !memberIds.has(u.id));
	}
</script>

<svelte:head>
	<title>Projects - Selva Admin</title>
</svelte:head>

<div class="w-full space-y-6 px-6 py-6">
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Projects</Card.Title>
					<Card.Description>
						{data.projects.length} project{data.projects.length === 1 ? '' : 's'}
					</Card.Description>
				</div>
				<Button
					onclick={() => (showAddForm = !showAddForm)}
					variant={showAddForm ? 'outline' : 'default'}
				>
					<Plus class="mr-2 h-4 w-4" />
					New Project
				</Button>
			</div>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Add project form -->
			{#if showAddForm}
				<div class="bg-muted/40 space-y-3 rounded-lg border p-4">
					<p class="text-sm font-medium">New Project</p>
					<div class="grid gap-3 sm:grid-cols-2">
						<div class="space-y-1">
							<Label>Name</Label>
							<Input bind:value={newName} placeholder="My Project" />
						</div>
						<div class="space-y-1">
							<Label>Visibility</Label>
							<select
								bind:value={newVisibility}
								class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
							>
								{#each VISIBILITY as v (v.value)}
									<option value={v.value}>{v.label} — {v.description}</option>
								{/each}
							</select>
						</div>
						<div class="space-y-1 sm:col-span-2">
							<Label>Description</Label>
							<Textarea bind:value={newDescription} rows={2} placeholder="Optional description…" />
						</div>
					</div>
					<div class="flex gap-2">
						<Button onclick={addProject} disabled={adding || !newName.trim()}>
							{adding ? 'Creating…' : 'Create'}
						</Button>
						<Button variant="outline" onclick={() => (showAddForm = false)}>Cancel</Button>
					</div>
				</div>
			{/if}

			<!-- Project list -->
			{#if data.projects.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<p class="text-sm font-medium">No projects yet</p>
				</div>
			{:else}
				<div class="space-y-4">
					{#each data.projects as project (project.id)}
						<div class="rounded-lg border">
							<!-- Project header -->
							<div class="flex items-start justify-between p-4">
								{#if editingId === project.id}
									<div class="grid flex-1 gap-3 pr-4 sm:grid-cols-2">
										<div class="space-y-1">
											<Label>Name</Label>
											<Input bind:value={editName} />
										</div>
										<div class="space-y-1">
											<Label>Visibility</Label>
											<select
												bind:value={editVisibility}
												class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
											>
												{#each VISIBILITY as v (v.value)}
													<option value={v.value}>{v.label} — {v.description}</option>
												{/each}
											</select>
										</div>
										<div class="space-y-1 sm:col-span-2">
											<Label>Description</Label>
											<Textarea bind:value={editDescription} rows={2} />
										</div>
										<div class="flex gap-2 sm:col-span-2">
											<Button size="sm" onclick={() => saveProject(project.id)} disabled={saving}>
												{saving ? 'Saving…' : 'Save'}
											</Button>
											<Button size="sm" variant="outline" onclick={cancelEdit}>Cancel</Button>
										</div>
									</div>
								{:else}
									<div class="min-w-0 flex-1">
										<div class="flex items-center gap-2">
											<p class="font-medium">{project.name}</p>
											<Badge variant="outline" class="text-xs">{project.visibility}</Badge>
										</div>
										{#if project.description}
											<p class="text-muted-foreground mt-0.5 text-sm">{project.description}</p>
										{/if}
										<p class="text-muted-foreground mt-0.5 font-mono text-xs">{project.id}</p>
										<p class="text-muted-foreground mt-1 text-xs">Only project owners can edit.</p>
									</div>
									<div class="ml-4 flex shrink-0 gap-1">
										<Button size="sm" variant="outline" onclick={() => startEdit(project)}>
											Edit
										</Button>
										<Button
											size="sm"
											variant="ghost"
											class="text-destructive hover:text-destructive"
											onclick={() => (deletingProjectId = project.id)}
										>
											<Trash2 class="h-4 w-4" />
										</Button>
									</div>
								{/if}
							</div>

							<!-- Members section -->
							<div class="border-t px-4 py-3">
								<div class="mb-3 space-y-2">
									<div class="flex items-center justify-between">
										<p class="text-muted-foreground text-xs font-medium">
											Members ({project.members.length})
										</p>
										{#if data.users.length > 0}
											<button
												class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline-offset-2 hover:underline"
												onclick={() => {
													addMemberProjectId = addMemberProjectId === project.id ? null : project.id;
													newMemberUserId = '';
													newMemberRole = 'viewer';
												}}
											>
												<UserPlus class="h-3 w-3" /> Add member
											</button>
										{/if}
									</div>
									{#if project.visibility !== 'private'}
										{@const note = VISIBILITY.find((v) => v.value === project.visibility)?.uploadNote}
										<p class="text-muted-foreground text-xs italic">{note}</p>
									{/if}
								</div>

								{#if addMemberProjectId === project.id}
									<div class="bg-muted/40 mb-3 flex gap-2 rounded-md p-2">
										<select
											bind:value={newMemberUserId}
											class="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-1 text-xs"
										>
											<option value="">Select user…</option>
											{#each availableUsers(project) as user (user.id)}
												<option value={user.id}>{user.email ?? user.id}</option>
											{/each}
										</select>
										<select
											bind:value={newMemberRole}
											class="border-input bg-background rounded-md border px-2 py-1 text-xs"
										>
											{#each ROLES as r (r.value)}
												<option value={r.value}>{r.label}</option>
											{/each}
										</select>
										<Button
											size="sm"
											class="h-7 px-2 text-xs"
											disabled={addingMember || !newMemberUserId}
											onclick={() => addMember(project.id)}
										>
											{addingMember ? '…' : 'Add'}
										</Button>
										<button
											class="text-muted-foreground hover:text-foreground"
											onclick={() => (addMemberProjectId = null)}
										>
											<X class="h-4 w-4" />
										</button>
									</div>
								{/if}

								{#if project.members.length === 0}
									<p class="text-muted-foreground text-xs">No members assigned.</p>
								{:else}
									<ul class="space-y-1">
										{#each project.members as member (`${member.projectId}:${member.userId}`)}
											<li class="flex items-center gap-2">
												<span class="min-w-0 flex-1 truncate text-xs">
													{userLabel(member.userId)}
												</span>
												<select
													value={member.role}
													onchange={(e) =>
														updateMemberRole(
															project.id,
															member.userId,
															(e.target as HTMLSelectElement).value as ProjectRole
														)}
													class="border-input bg-background rounded-md border px-2 py-0.5 text-xs"
												>
													{#each ROLES as r (r.value)}
														<option value={r.value}>{r.label}</option>
													{/each}
												</select>
												<button
													class="text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-40"
													disabled={removingMember === `${project.id}:${member.userId}`}
													onclick={() => removeMember(project.id, member.userId)}
												>
													<X class="h-3.5 w-3.5" />
												</button>
											</li>
										{/each}
									</ul>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<!-- Delete project confirmation -->
<AlertDialog.Root
	open={!!deletingProjectId}
	onOpenChange={(o) => {
		if (!o) deletingProjectId = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Project?</AlertDialog.Title>
			<AlertDialog.Description>
				This will delete "{data.projects.find((p) => p.id === deletingProjectId)?.name ?? ''}" and
				all its members. Definitions in this project will become unassigned.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => deletingProjectId && deleteProject(deletingProjectId)}>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
