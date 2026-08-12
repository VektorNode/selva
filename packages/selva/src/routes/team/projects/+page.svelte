<script lang="ts">
	import {
		AlertDialog,
		Button,
		Card,
		DataTable,
		EmptyState,
		Input,
		SectionHeader,
		toast
	} from '@selvajs/ui';
	import { Plus, Trash2, FolderKanban, ExternalLink } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import type { ProjectVisibility } from '@selvajs/platform';
	import type { ProjectRow } from './+page.server';

	interface PageData {
		projects: ProjectRow[];
		canCreate: boolean;
	}
	let { data }: { data: PageData } = $props();

	const VISIBILITY_TONE: Record<string, string> = {
		public: 'border-success/40 text-success',
		org: 'border-blue-500/40 text-blue-600 dark:text-blue-400',
		private: 'border-border text-muted-foreground'
	};
	const VISIBILITY_OPTIONS: ProjectVisibility[] = ['private', 'org', 'public'];

	let showCreateForm = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newVisibility = $state<ProjectVisibility>('private');
	let creating = $state(false);

	let confirmingDelete = $state<ProjectRow | null>(null);
	let deletingId = $state<string | null>(null);

	async function createProject() {
		creating = true;
		try {
			const res = await fetch('/api/v1/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newName,
					description: newDescription || undefined,
					visibility: newVisibility
				})
			});
			if (res.ok) {
				toast.success(`Project "${newName}" created`);
				newName = '';
				newDescription = '';
				newVisibility = 'private';
				showCreateForm = false;
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to create project');
			}
		} catch {
			toast.error('Failed to create project');
		} finally {
			creating = false;
		}
	}

	async function deleteProject(project: ProjectRow) {
		deletingId = project.id;
		try {
			const res = await fetch(`/api/v1/projects/${project.id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success(`Deleted "${project.name}"`);
				await invalidateAll();
			} else {
				const err = await res.json().catch(() => ({}));
				toast.error(err.message || err.error || 'Failed to delete project');
			}
		} catch {
			toast.error('Failed to delete project');
		} finally {
			deletingId = null;
			confirmingDelete = null;
		}
	}
</script>

<svelte:head>
	<title>Team · Projects</title>
</svelte:head>

<div class="space-y-6">
	<SectionHeader
		eyebrow="Team"
		title="Projects"
		description={`${data.projects.length} project${data.projects.length === 1 ? '' : 's'} in this organization.`}
	>
		{#snippet actions()}
			{#if data.canCreate}
				<Button
					onclick={() => (showCreateForm = !showCreateForm)}
					variant={showCreateForm ? 'outline' : 'default'}
				>
					<Plus class="mr-2 h-4 w-4" />
					New project
				</Button>
			{/if}
		{/snippet}
	</SectionHeader>

	{#if showCreateForm}
		<Card.Root>
			<Card.Content class="space-y-3 pt-6">
				<div>
					<p class="text-sm font-medium">New project</p>
					<p class="text-muted-foreground text-xs">
						Visibility can be changed later. Public requires the platform flag.
					</p>
				</div>
				<div class="grid gap-3 sm:grid-cols-2">
					<Input placeholder="Project name" bind:value={newName} />
					<select
						bind:value={newVisibility}
						class="border-input bg-background h-9 rounded-md border px-3 text-sm"
					>
						{#each VISIBILITY_OPTIONS as v (v)}
							<option value={v}>{v}</option>
						{/each}
					</select>
				</div>
				<Input placeholder="Description (optional)" bind:value={newDescription} />
				<div class="flex gap-2">
					<Button onclick={createProject} disabled={creating || !newName}>
						{creating ? 'Creating…' : 'Create project'}
					</Button>
					<Button variant="outline" onclick={() => (showCreateForm = false)}>Cancel</Button>
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Content class="pt-6">
			{#if data.projects.length === 0}
				<EmptyState
					icon={FolderKanban}
					title="No projects yet"
					description="Create your first project to start uploading definitions."
				/>
			{:else}
				<DataTable
					rows={data.projects}
					getKey={(p) => p.id}
					columns={[
						{ label: 'Project' },
						{ label: 'Visibility', width: '120px' },
						{ label: 'Members', width: '100px', align: 'right' },
						{ label: 'Updated', width: '120px', align: 'right' },
						{ label: '', width: '80px' }
					]}
				>
					{#snippet row(project)}
						<div class="min-w-0">
							<div class="flex items-center gap-2">
								<a
									href={`/projects?project=${project.slug}`}
									class="truncate text-sm font-medium hover:underline"
								>
									{project.name}
								</a>
								<a
									href={`/projects?project=${project.slug}`}
									class="text-muted-foreground hover:text-foreground"
									aria-label="Open project"
								>
									<ExternalLink class="h-3.5 w-3.5" />
								</a>
							</div>
							<p class="text-muted-foreground truncate font-mono text-xs">{project.slug}</p>
						</div>
						<span
							class={`w-fit rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${VISIBILITY_TONE[project.visibility] ?? VISIBILITY_TONE.private}`}
						>
							{project.visibility}
						</span>
						<span class="text-right font-mono text-sm tabular-nums">{project.memberCount}</span>
						<span class="text-muted-foreground text-right text-xs">
							{new Date(project.updatedAt).toLocaleDateString()}
						</span>
						<div class="flex justify-end">
							<Button
								size="sm"
								variant="ghost"
								disabled={deletingId === project.id}
								onclick={() => (confirmingDelete = project)}
								class="text-destructive hover:text-destructive h-8 w-8 p-0"
							>
								<Trash2 class="h-4 w-4" />
							</Button>
						</div>
					{/snippet}
				</DataTable>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<AlertDialog.Root open={!!confirmingDelete} onOpenChange={(o) => !o && (confirmingDelete = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this project?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if confirmingDelete}
					<strong>{confirmingDelete.name}</strong> will be removed from view immediately. Permanent deletion
					happens after the retention window.
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() => confirmingDelete && deleteProject(confirmingDelete)}
				disabled={!!deletingId}
			>
				{deletingId ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
