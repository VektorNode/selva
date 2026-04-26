<script lang="ts">
	import { Button, Input } from '@selvajs/shared';
	import { Plus, X } from '@lucide/svelte';
	import type { ProjectWithMembers, DefinitionRecord } from '../+page.server';
	import type { ProjectVisibility } from '@selvajs/platform/projects';
	import { projectColor } from './statusStyles';

	interface Props {
		projects: ProjectWithMembers[];
		records: DefinitionRecord[];
		activeProjectId: string | null;
		canManageProjects: boolean;
		onSelect: (id: string) => void;
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

<aside class="border-border bg-background flex w-56 shrink-0 flex-col overflow-y-auto border-r">
	<div class="flex items-center justify-between px-4 pt-5 pb-2">
		<span class="text-muted-foreground font-mono text-[10px] tracking-widest uppercase"
			>Projects</span
		>
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
		<div class="border-border bg-muted/40 mx-3 mb-2 space-y-2 rounded-lg border p-3">
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

	<nav class="flex-1 px-2 pb-4">
		{#each projects as project (project.id)}
			{@const isActive = activeProjectId === project.id}
			{@const defCount = records.filter((r) => r.projectId === project.id).length}
			<button
				onclick={() => onSelect(project.id)}
				class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors
					{isActive
					? 'bg-muted text-foreground'
					: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
			>
				<span class="h-4 w-4 shrink-0 rounded" style="background-color: {projectColor(project.id)}"
				></span>
				<span class="flex-1 truncate text-sm font-medium">{project.name}</span>
				<span class="shrink-0 font-mono text-[11px] opacity-60">{defCount}</span>
			</button>
		{/each}

		{#if projects.length === 0}
			<p class="text-muted-foreground px-2 py-4 text-center text-xs">No projects yet</p>
		{/if}
	</nav>
</aside>
