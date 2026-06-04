<script lang="ts">
	import { Button, Input } from '@selvajs/ui';
	import { Plus, X, Search, FolderOpen } from '@lucide/svelte';
	import type { ProjectWithMembers, DefinitionRecord } from '../+page.server';
	import type { ProjectVisibility } from '@selvajs/platform/projects';

	interface Props {
		projects: ProjectWithMembers[];
		records: DefinitionRecord[];
		activeProjectId: string | null;
		canManageProjects: boolean;
		onSelect: (id: string | null) => void;
		onCreate: (payload: {
			name: string;
			description: string;
			visibility: ProjectVisibility;
		}) => Promise<void>;
	}

	let { projects, records, activeProjectId, canManageProjects, onSelect, onCreate }: Props =
		$props();

	let showForm = $state(false);
	let newName = $state('');
	let newDescription = $state('');
	let newVisibility = $state<ProjectVisibility>('public');
	let creating = $state(false);

	let filterQuery = $state('');

	const filteredProjects = $derived.by(() => {
		const q = filterQuery.trim().toLowerCase();
		if (!q) return projects;
		return projects.filter((p) => p.name.toLowerCase().includes(q));
	});

	async function submit() {
		if (!newName.trim()) return;
		creating = true;
		try {
			await onCreate({
				name: newName.trim(),
				description: newDescription,
				visibility: newVisibility
			});
			newName = '';
			newDescription = '';
			newVisibility = 'public';
			showForm = false;
		} finally {
			creating = false;
		}
	}
</script>

<aside class="border-border bg-background flex w-60 shrink-0 flex-col overflow-y-auto border-r">
	<div class="flex items-center justify-between px-4 pt-5 pb-3">
		<span class="text-muted-foreground text-xs font-medium tracking-wider uppercase">
			Projects
		</span>
		{#if canManageProjects}
			<button
				onclick={() => (showForm = !showForm)}
				class="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
				title="New project"
				aria-label="New project"
			>
				<Plus class="h-3.5 w-3.5" />
			</button>
		{/if}
	</div>

	{#if showForm && canManageProjects}
		<div class="border-border bg-muted/40 mx-3 mb-3 space-y-2 rounded-md border p-3">
			<Input bind:value={newName} placeholder="Project name" class="h-8 text-xs" />
			<select
				bind:value={newVisibility}
				class="border-input bg-background w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
			>
				<option value="public">Public</option>
				<option value="org">Org</option>
				<option value="private">Private</option>
			</select>
			<div class="flex gap-1.5">
				<Button
					onclick={submit}
					disabled={creating || !newName.trim()}
					size="sm"
					class="h-6 flex-1 text-xs"
				>
					{creating ? '…' : 'Create'}
				</Button>
				<Button
					onclick={() => (showForm = false)}
					variant="ghost"
					size="sm"
					class="h-6 px-2 text-xs"
				>
					<X class="h-3 w-3" />
				</Button>
			</div>
		</div>
	{/if}

	{#if projects.length > 4}
		<div class="relative mx-3 mb-2">
			<Search
				class="text-muted-foreground pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2"
			/>
			<input
				bind:value={filterQuery}
				placeholder="Filter projects"
				class="border-input bg-background placeholder:text-muted-foreground focus:border-ring h-7 w-full rounded-md border pr-2 pl-7 text-xs transition-colors outline-none"
			/>
		</div>
	{/if}

	<nav class="flex-1 space-y-px pr-2 pb-4">
		<!-- All projects pseudo-row -->
		<button
			onclick={() => onSelect(null)}
			class={`group relative flex w-full items-center gap-2 py-1.5 pr-2.5 text-left transition-colors ${
				activeProjectId === null
					? 'bg-accent text-accent-foreground rounded-r-md pl-4'
					: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground mx-2 rounded-md pl-2.5'
			}`}
		>
			{#if activeProjectId === null}
				<span class="bg-primary absolute top-0 bottom-0 left-0 w-0.75" aria-hidden="true"></span>
			{/if}
			<FolderOpen class="h-3.5 w-3.5 shrink-0 opacity-70" />
			<span class="flex-1 truncate text-sm font-medium">All projects</span>
		</button>

		{#if filteredProjects.length > 0}
			<div class="border-border/60 my-2 border-t"></div>
		{/if}

		{#each filteredProjects as project (project.id)}
			{@const isActive = activeProjectId === project.id}
			{@const defCount = records.filter((r) => r.projectId === project.id).length}
			<button
				onclick={() => onSelect(project.id)}
				class={`group relative flex w-full items-center gap-2 py-1.5 pr-2.5 text-left transition-colors ${
					isActive
						? 'bg-accent text-accent-foreground rounded-r-md pl-4'
						: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground mx-2 rounded-md pl-2.5'
				}`}
			>
				{#if isActive}
					<span class="bg-primary absolute top-0 bottom-0 left-0 w-0.75" aria-hidden="true"></span>
				{/if}
				<span class="flex-1 truncate text-sm font-medium">{project.name}</span>
				<span class="shrink-0 font-mono text-[11px] tabular-nums opacity-60">{defCount}</span>
			</button>
		{/each}

		{#if projects.length === 0}
			<p class="text-muted-foreground px-2 py-4 text-center text-xs">No projects yet</p>
		{:else if filteredProjects.length === 0 && filterQuery}
			<p class="text-muted-foreground px-2 py-4 text-center text-xs">
				No matches for "{filterQuery}"
			</p>
		{/if}
	</nav>
</aside>
