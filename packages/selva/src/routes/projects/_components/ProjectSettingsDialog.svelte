<script lang="ts">
	import { Button, Dialog, EmptyState, Input, Label, Tabs, Textarea } from '@selvajs/ui';
	import { Trash2, UserPlus, Users, X } from '@lucide/svelte';
	import type { ProjectWithMembers, UserListItem } from '../+page.server';
	import type { ProjectRole, ProjectVisibility } from '@selvajs/platform/projects';
	import UserAvatar from '$lib/components/UserAvatar.svelte';
	import AddMemberPicker from './AddMemberPicker.svelte';

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

	let tab = $state('general');
	let showAddForm = $state(false);
	let adding = $state(false);
	let removing = $state<string | null>(null);

	function userLabel(userId: string) {
		const u = users.find((u) => u.id === userId);
		return u?.displayName ?? u?.email ?? userId.slice(0, 8);
	}

	function userEmail(userId: string) {
		return users.find((u) => u.id === userId)?.email;
	}

	const visibilityHint = $derived(
		{
			public: 'Any authenticated user can solve this project.',
			org: 'Any member of the organization can solve this project.',
			private: 'Only the project members listed under Members can solve this project.',
			platform: 'Managed by platform admins — access is granted per org or user.'
		}[visibility]
	);

	// The saved visibility, not the unsaved `visibility` form state — this copy
	// describes who can reach the project right now, and the Members tab is live
	// while the General tab's select is still a draft.
	const membersGrantAccess = $derived(project.visibility === 'private');

	// There is no deny-list: `canView` consults membership only on a private
	// project (rules.ts). On any other visibility, removing a member takes away
	// their role — not their access — and the removal button must say so, or an
	// admin offboarding a contractor watches the row vanish and reasonably
	// concludes the opposite.
	const membershipMeaning = $derived(
		{
			public:
				'Every authenticated user can already view and solve this project, whether or not they are a member. Membership here only grants editing rights.',
			org: 'Every member of the organization can already view and solve this project, whether or not they are a member here. Membership only grants editing rights.',
			private: 'This project is private, so this list is exactly who can reach it.',
			platform:
				'Access to a platform project is granted by platform admins per org or user. Membership here only grants editing rights.'
		}[project.visibility]
	);

	function removalWarning(userId: string) {
		const who = userLabel(userId);
		if (membersGrantAccess) {
			return `Remove ${who} from this project? They lose access to it.`;
		}
		return `Remove ${who} from this project? They lose editing rights, but ${
			project.visibility === 'org' ? 'every member of the organization' : 'anyone who can reach it'
		} keeps view and solve access — including them. Make the project private if you need to cut off access.`;
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

	async function add(userId: string, role: ProjectRole) {
		adding = true;
		try {
			await onAddMember(project.id, userId, role);
			showAddForm = false;
		} finally {
			adding = false;
		}
	}

	async function remove(userId: string) {
		if (!confirm(removalWarning(userId))) return;
		removing = userId;
		try {
			await onRemoveMember(project.id, userId);
		} finally {
			removing = null;
		}
	}
</script>

<Dialog.Root {open} {onOpenChange}>
	<Dialog.Content class="flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden">
		<Dialog.Header class="shrink-0">
			<Dialog.Title>Project settings</Dialog.Title>
			<Dialog.Description>Manage this project's details and members.</Dialog.Description>
		</Dialog.Header>

		<Tabs.Root bind:value={tab} class="mt-2 flex h-120 min-h-0 flex-col">
			<Tabs.List class="grid w-full shrink-0 grid-cols-2">
				<Tabs.Trigger value="general">General</Tabs.Trigger>
				<Tabs.Trigger value="members" class="gap-1.5">
					<Users class="h-3.5 w-3.5" /> Members
					<span class="text-muted-foreground ml-1 font-mono text-[11px]"
						>{project.members.length}</span
					>
				</Tabs.Trigger>
			</Tabs.List>

			<Tabs.Content
				value="general"
				class="mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1 data-[state=inactive]:hidden"
			>
				<div class="space-y-1.5">
					<Label for="proj-name">Name</Label>
					<Input id="proj-name" bind:value={name} />
				</div>
				<div class="space-y-1.5">
					<Label for="proj-desc">Description</Label>
					<Textarea id="proj-desc" bind:value={description} rows={5} />
				</div>
				<div class="space-y-1.5">
					<Label for="proj-vis">Visibility</Label>
					<select
						id="proj-vis"
						bind:value={visibility}
						class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
					>
						<option value="public">Public</option>
						<option value="org">Org</option>
						<option value="private">Private</option>
						{#if visibility === 'platform'}
							<option value="platform">Platform</option>
						{/if}
					</select>
					<p class="text-muted-foreground text-xs">{visibilityHint}</p>
				</div>
			</Tabs.Content>

			<Tabs.Content
				value="members"
				class="mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-hidden data-[state=inactive]:hidden"
			>
				<p
					class={`shrink-0 rounded-md border px-3 py-2 text-xs ${
						membersGrantAccess
							? 'border-border bg-muted/40 text-muted-foreground'
							: 'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400'
					}`}
				>
					{membershipMeaning}
				</p>

				{#if project.members.length === 0 && !showAddForm}
					<EmptyState
						size="sm"
						icon={Users}
						title="No members yet"
						description={membersGrantAccess
							? 'Add members to give them access to this project.'
							: 'Add members to give them editing rights on this project.'}
					/>
				{:else if project.members.length > 0}
					<div class="border-border bg-card min-h-0 flex-1 overflow-y-auto rounded-md border">
						{#each project.members as member (`${member.projectId}:${member.userId}`)}
							<div class="border-border flex items-center gap-3 border-b px-3 py-2.5 last:border-0">
								<div class="shrink-0">
									<UserAvatar name={userLabel(member.userId)} size="sm" />
								</div>
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{userLabel(member.userId)}</p>
									{#if userEmail(member.userId) && userEmail(member.userId) !== userLabel(member.userId)}
										<p class="text-muted-foreground truncate font-mono text-xs">
											{userEmail(member.userId)}
										</p>
									{/if}
								</div>
								<select
									value={member.role}
									onchange={(e) =>
										onUpdateMemberRole(
											project.id,
											member.userId,
											(e.target as HTMLSelectElement).value as ProjectRole
										)}
									class="border-input bg-background h-8 shrink-0 rounded-md border px-2 text-xs outline-none"
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
									class="text-muted-foreground hover:text-destructive h-7 w-7 shrink-0"
								>
									<X class="h-3.5 w-3.5" />
								</Button>
							</div>
						{/each}
					</div>
				{/if}

				<div class="shrink-0">
					{#if showAddForm}
						<AddMemberPicker
							{availableUsers}
							{adding}
							onAdd={add}
							onCancel={() => (showAddForm = false)}
						/>
					{:else}
						<Button
							onclick={() => (showAddForm = true)}
							variant="outline"
							size="sm"
							class="gap-1.5"
						>
							<UserPlus class="h-3.5 w-3.5" /> Add member
						</Button>
					{/if}
				</div>
			</Tabs.Content>
		</Tabs.Root>

		<div class="border-border mt-4 flex shrink-0 items-center justify-between border-t pt-4">
			<Button
				onclick={() => onDelete(project.id)}
				variant="ghost"
				size="sm"
				class="text-destructive hover:text-destructive gap-1.5 px-2"
			>
				<Trash2 class="h-3.5 w-3.5" /> Delete project
			</Button>
			<div class="flex gap-2">
				<Button onclick={() => onOpenChange(false)} variant="outline" size="sm">
					{tab === 'general' ? 'Cancel' : 'Close'}
				</Button>
				{#if tab === 'general'}
					<Button onclick={save} disabled={saving} size="sm">
						{saving ? 'Saving…' : 'Save'}
					</Button>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
