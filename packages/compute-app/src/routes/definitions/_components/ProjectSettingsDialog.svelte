<script lang="ts">
	import { Button, Dialog, Input, Label, Tabs, Textarea } from '@selvajs/shared';
	import { Trash2, UserPlus, Users, X } from '@lucide/svelte';
	import type { ProjectWithMembers, UserListItem } from '../+page.server';
	import type { ProjectRole, ProjectVisibility } from '@selvajs/platform/projects';

	interface Props {
		project: ProjectWithMembers;
		users: UserListItem[];
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onSave: (
			id: string,
			patch: { name: string; description: string; visibility: ProjectVisibility }
		) => Promise<void>;
		onDelete: (id: string) => void;
		onAddMember: (projectId: string, userId: string, role: ProjectRole) => Promise<void>;
		onUpdateMemberRole: (projectId: string, userId: string, role: ProjectRole) => Promise<void>;
		onRemoveMember: (projectId: string, userId: string) => Promise<void>;
	}

	let {
		project,
		users,
		open,
		onOpenChange,
		onSave,
		onDelete,
		onAddMember,
		onUpdateMemberRole,
		onRemoveMember
	}: Props = $props();

	// Form state — initialized once from project at mount. Parent unmounts
	// the dialog on project change, so every project gets a fresh instance.
	/* svelte-ignore state_referenced_locally */
	let name = $state(project.name);
	/* svelte-ignore state_referenced_locally */
	let description = $state(project.description ?? '');
	/* svelte-ignore state_referenced_locally */
	let visibility = $state<ProjectVisibility>(project.visibility);
	let saving = $state(false);

	let showAddForm = $state(false);
	let newMemberUserId = $state('');
	let newMemberRole = $state<ProjectRole>('viewer');
	let adding = $state(false);
	let removing = $state<string | null>(null);

	function userLabel(userId: string) {
		const u = users.find((u) => u.id === userId);
		return u?.displayName ?? u?.email ?? userId.slice(0, 8);
	}

	const availableUsers = $derived.by(() => {
		const ids = new Set(project.members.map((m) => m.userId));
		return users.filter((u) => !ids.has(u.id));
	});

	async function save() {
		saving = true;
		try {
			await onSave(project.id, { name, description, visibility });
		} finally {
			saving = false;
		}
	}

	async function add() {
		if (!newMemberUserId) return;
		adding = true;
		try {
			await onAddMember(project.id, newMemberUserId, newMemberRole);
			newMemberUserId = '';
			newMemberRole = 'viewer';
			showAddForm = false;
		} finally {
			adding = false;
		}
	}

	async function remove(userId: string) {
		removing = userId;
		try {
			await onRemoveMember(project.id, userId);
		} finally {
			removing = null;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Project settings</Dialog.Title>
			<Dialog.Description>Manage this project's details and members.</Dialog.Description>
		</Dialog.Header>

		<Tabs.Root value="general" class="mt-2">
			<Tabs.List class="grid w-full grid-cols-2">
				<Tabs.Trigger value="general">General</Tabs.Trigger>
				<Tabs.Trigger value="members" class="gap-1.5">
					<Users class="h-3.5 w-3.5" /> Members
					<span class="text-muted-foreground ml-1 font-mono text-[11px]"
						>{project.members.length}</span
					>
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content value="general" class="mt-4 space-y-4">
				<div class="space-y-1.5">
					<Label for="proj-name">Name</Label>
					<Input id="proj-name" bind:value={name} />
				</div>
				<div class="space-y-1.5">
					<Label for="proj-desc">Description</Label>
					<Textarea id="proj-desc" bind:value={description} rows={2} />
				</div>
				<div class="space-y-1.5">
					<Label for="proj-vis">Visibility</Label>
					<select
						id="proj-vis"
						bind:value={visibility}
						class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
					>
						<option value="public">Public — any authenticated user can solve</option>
						<option value="org">Org — any org member can solve</option>
						<option value="private">Private — only project members can solve</option>
					</select>
				</div>
				<div class="flex items-center justify-between pt-2">
					<Button
						onclick={() => onDelete(project.id)}
						variant="ghost"
						size="sm"
						class="text-destructive hover:text-destructive gap-1.5 px-2"
					>
						<Trash2 class="h-3.5 w-3.5" /> Delete project
					</Button>
					<div class="flex gap-2">
						<Button onclick={() => onOpenChange(false)} variant="outline" size="sm">Cancel</Button>
						<Button onclick={save} disabled={saving} size="sm">
							{saving ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</div>
			</Tabs.Content>

			<Tabs.Content value="members" class="mt-4 space-y-3">
				{#if project.members.length === 0 && !showAddForm}
					<div
						class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-10 text-center"
					>
						<Users class="text-muted-foreground mb-2 h-7 w-7" />
						<p class="text-sm font-medium">No members yet</p>
						<p class="text-muted-foreground mt-1 text-xs">
							Add members to control who can edit this project.
						</p>
					</div>
				{:else}
					<div class="border-border bg-card overflow-hidden rounded-xl border">
						{#each project.members as member (`${member.projectId}:${member.userId}`)}
							<div class="border-border flex items-center gap-3 border-b px-3 py-2.5 last:border-0">
								<div
									class="bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
								>
									{userLabel(member.userId)[0]?.toUpperCase() ?? '?'}
								</div>
								<span class="flex-1 truncate text-sm">{userLabel(member.userId)}</span>
								<select
									value={member.role}
									onchange={(e) =>
										onUpdateMemberRole(
											project.id,
											member.userId,
											(e.target as HTMLSelectElement).value as ProjectRole
										)}
									class="border-input bg-background rounded-md border px-2 py-1 text-xs outline-none"
								>
									<option value="owner">Owner</option>
									<option value="editor">Editor</option>
									<option value="viewer">Viewer</option>
								</select>
								<Button
									onclick={() => remove(member.userId)}
									disabled={removing === member.userId}
									variant="ghost"
									size="icon"
									class="text-muted-foreground hover:text-destructive h-7 w-7"
								>
									<X class="h-3.5 w-3.5" />
								</Button>
							</div>
						{/each}
					</div>
				{/if}

				{#if showAddForm}
					<div class="border-border bg-card flex items-center gap-2 rounded-xl border p-2.5">
						<select
							bind:value={newMemberUserId}
							class="border-input bg-background min-w-0 flex-1 rounded-md border px-2 py-1.5 text-sm outline-none"
						>
							<option value="">Select user…</option>
							{#each availableUsers as u (u.id)}
								<option value={u.id}>{u.email ?? u.id}</option>
							{/each}
						</select>
						<select
							bind:value={newMemberRole}
							class="border-input bg-background rounded-md border px-2 py-1.5 text-sm outline-none"
						>
							<option value="owner">Owner</option>
							<option value="editor">Editor</option>
							<option value="viewer">Viewer</option>
						</select>
						<Button onclick={add} disabled={adding || !newMemberUserId} size="sm">
							{adding ? '…' : 'Add'}
						</Button>
						<Button
							onclick={() => (showAddForm = false)}
							variant="ghost"
							size="icon"
							class="text-muted-foreground h-8 w-8"
						>
							<X class="h-4 w-4" />
						</Button>
					</div>
				{:else}
					<Button
						onclick={() => {
							showAddForm = true;
							newMemberUserId = '';
							newMemberRole = 'viewer';
						}}
						variant="outline"
						size="sm"
						class="gap-1.5"
					>
						<UserPlus class="h-3.5 w-3.5" /> Add member
					</Button>
				{/if}
			</Tabs.Content>
		</Tabs.Root>
	</Dialog.Content>
</Dialog.Root>
