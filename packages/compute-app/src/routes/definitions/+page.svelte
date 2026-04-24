<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { AlertDialog, Button, Search, toast } from 'selva-shared';
	import { Grid2x2, List, Plus, Settings } from '@lucide/svelte';
	import AddDefinitionDialog from '$lib/components/definitions/AddDefinitionDialog.svelte';
	import ProjectSidebar from './_components/ProjectSidebar.svelte';
	import ProjectSettingsDialog from './_components/ProjectSettingsDialog.svelte';
	import DefinitionGridCard from './_components/DefinitionGridCard.svelte';
	import DefinitionListView from './_components/DefinitionListView.svelte';
	import DefinitionDetailDrawer from './_components/DefinitionDetailDrawer.svelte';
	import DefinitionEditDrawer from './_components/DefinitionEditDrawer.svelte';
	import type { EditPatch } from './_components/DefinitionEditDrawer.svelte';
	import type {
		DefinitionRecord,
		ProjectWithMembers,
		ComputeServerConfig,
		AuthUser
	} from './+page.server';
	import type { ProjectRole, ProjectVisibility } from '@selva/platform/projects';

	interface PageData {
		projects: ProjectWithMembers[];
		records: DefinitionRecord[];
		computeServers: ComputeServerConfig[];
		users: AuthUser[];
		canManageProjects: boolean;
	}
	interface Props {
		data: PageData;
	}
	let { data }: Props = $props();

	// View state
	let searchQuery = $state('');
	let activeProjectId = $state<string | null>(null);
	let viewMode = $state<'grid' | 'list'>('grid');

	// Panels / dialogs
	let drawerRecord = $state<DefinitionRecord | null>(null);
	let editingDefinitionId = $state<string | null>(null);
	let editingProjectId = $state<string | null>(null);
	let deletingProjectId = $state<string | null>(null);
	let showAddModal = $state(false);

	// In-flight flags
	let addingDefinition = $state(false);
	let savingDefinitionId = $state<string | null>(null);

	$effect(() => {
		if (data.projects.length > 0 && activeProjectId === null) {
			activeProjectId = data.projects[0]?.id ?? null;
		}
	});

	const filtered = $derived.by(() => {
		let records = data.records;
		if (activeProjectId) records = records.filter((r) => r.projectId === activeProjectId);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			records = records.filter(
				(r) =>
					r.displayName?.toLowerCase().includes(q) ||
					r.description?.toLowerCase().includes(q) ||
					r.tags?.some((t) => t.toLowerCase().includes(q))
			);
		}
		return records;
	});

	const editingRecord = $derived(
		editingDefinitionId
			? (data.records.find((r) => r.guid === editingDefinitionId) ?? null)
			: null
	);
	const activeProject = $derived(
		activeProjectId ? (data.projects.find((p) => p.id === activeProjectId) ?? null) : null
	);
	const editingProject = $derived(
		editingProjectId ? (data.projects.find((p) => p.id === editingProjectId) ?? null) : null
	);
	const deletingProject = $derived(
		deletingProjectId ? (data.projects.find((p) => p.id === deletingProjectId) ?? null) : null
	);

	function projectName(id: string) {
		return data.projects.find((p) => p.id === id)?.name ?? '';
	}

	async function errorMessage(res: Response, fallback: string) {
		if (res.headers.get('content-type')?.includes('application/json')) {
			const e = await res.json().catch(() => null);
			return e?.message || e?.error?.message || `${fallback} (${res.status})`;
		}
		return `${fallback} (${res.status})`;
	}

	// ── Definitions ──────────────────────────────────────────────────────────
	async function saveDefinition(guid: string, patch: EditPatch) {
		savingDefinitionId = guid;
		try {
			const res = await fetch(`/api/definitions/${guid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (res.ok) {
				toast.success('Definition saved');
				editingDefinitionId = null;
				drawerRecord = null;
				await invalidateAll();
			} else {
				toast.error(await errorMessage(res, 'Save failed'));
			}
		} catch (e) {
			toast.error('Save failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
		} finally {
			savingDefinitionId = null;
		}
	}

	async function deleteDefinition(guid: string) {
		const rec = data.records.find((r) => r.guid === guid);
		try {
			const res = await fetch(`/api/definitions/${guid}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success(`"${rec?.displayName ?? 'Definition'}" deleted`);
				editingDefinitionId = null;
				await invalidateAll();
			} else {
				toast.error(await errorMessage(res, 'Delete failed'));
			}
		} catch {
			toast.error('Delete failed');
		}
	}

	async function submitAddDefinition(formData: FormData) {
		addingDefinition = true;
		try {
			const res = await fetch('/api/definitions', { method: 'POST', body: formData });
			if (res.ok) {
				toast.success(`"${formData.get('displayName')}" created`);
				showAddModal = false;
				await invalidateAll();
			} else {
				const msg = await errorMessage(res, 'Failed to create definition');
				toast.error(msg);
				throw new Error(msg);
			}
		} finally {
			addingDefinition = false;
		}
	}

	// ── Projects ─────────────────────────────────────────────────────────────
	async function createProject(p: {
		name: string;
		description: string;
		visibility: ProjectVisibility;
	}) {
		const res = await fetch('/api/projects', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(p)
		});
		if (res.ok) {
			toast.success(`Project "${p.name}" created`);
			await invalidateAll();
		} else {
			toast.error(await errorMessage(res, 'Failed to create project'));
			throw new Error('create project failed');
		}
	}

	async function saveProject(
		id: string,
		patch: { name: string; description: string; visibility: ProjectVisibility }
	) {
		const res = await fetch(`/api/projects/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (res.ok) {
			toast.success('Project saved');
			editingProjectId = null;
			await invalidateAll();
		} else {
			toast.error(await errorMessage(res, 'Failed to save project'));
		}
	}

	async function deleteProject(id: string) {
		const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
		if (res.ok) {
			toast.success('Project deleted');
			if (activeProjectId === id) {
				activeProjectId = data.projects.find((p) => p.id !== id)?.id ?? null;
			}
			deletingProjectId = null;
			editingProjectId = null;
			await invalidateAll();
		} else {
			toast.error(await errorMessage(res, 'Failed to delete project'));
		}
	}

	// ── Members ──────────────────────────────────────────────────────────────
	async function addMember(projectId: string, userId: string, role: ProjectRole) {
		const res = await fetch(`/api/projects/${projectId}/members`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId, role })
		});
		if (res.ok) {
			toast.success('Member added');
			await invalidateAll();
		} else {
			toast.error(await errorMessage(res, 'Failed to add member'));
		}
	}

	async function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
		const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ role })
		});
		if (res.ok) await invalidateAll();
		else toast.error('Failed to update role');
	}

	async function removeMember(projectId: string, userId: string) {
		const res = await fetch(`/api/projects/${projectId}/members/${userId}`, {
			method: 'DELETE'
		});
		if (res.ok) await invalidateAll();
		else toast.error('Failed to remove member');
	}
</script>

<svelte:head>
	<title>Definitions – Selva</title>
</svelte:head>

<div class="flex h-[calc(100vh-3.5rem)] overflow-hidden">
	<ProjectSidebar
		projects={data.projects}
		records={data.records}
		{activeProjectId}
		canManageProjects={data.canManageProjects}
		onSelect={(id) => (activeProjectId = id)}
		onCreate={createProject}
	/>

	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="border-border bg-background shrink-0 border-b px-6 pt-6 pb-3">
			<div class="flex items-end justify-between gap-4">
				<div>
					{#if activeProject}
						<p class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
							{activeProject.name}
						</p>
					{/if}
					<h1 class="mt-1.5 text-2xl font-semibold tracking-tight">Definitions</h1>
				</div>
				<div class="flex shrink-0 items-center gap-2 pb-0.5">
					{#if data.canManageProjects && activeProject}
						<Button
							variant="outline"
							size="sm"
							onclick={() => (editingProjectId = activeProject.id)}
							class="gap-1.5"
						>
							<Settings class="h-3.5 w-3.5" /> Project settings
						</Button>
					{/if}
					<Button size="sm" onclick={() => (showAddModal = true)} class="gap-1.5">
						<Plus class="h-3.5 w-3.5" /> Add definition
					</Button>
				</div>
			</div>
		</div>

		<div class="flex-1 overflow-y-auto px-6 py-5">
			<div class="mb-5 flex items-center gap-3">
				<div class="max-w-lg flex-1">
					<Search
						bind:value={searchQuery}
						placeholder="Search by name, description, tags…"
						clearable
					/>
				</div>
				<span class="text-muted-foreground font-mono text-[12px]">
					{filtered.length} definition{filtered.length === 1 ? '' : 's'}
				</span>
				<div class="border-border ml-auto flex overflow-hidden rounded-lg border">
					<button
						onclick={() => (viewMode = 'grid')}
						class="p-1.5 transition-colors {viewMode === 'grid'
							? 'bg-muted'
							: 'bg-card hover:bg-muted/60'}"
						title="Grid view"
						aria-label="Grid view"
					>
						<Grid2x2 class="h-3.5 w-3.5" />
					</button>
					<button
						onclick={() => (viewMode = 'list')}
						class="border-border border-l p-1.5 transition-colors {viewMode === 'list'
							? 'bg-muted'
							: 'bg-card hover:bg-muted/60'}"
						title="List view"
						aria-label="List view"
					>
						<List class="h-3.5 w-3.5" />
					</button>
				</div>
			</div>

			{#if filtered.length === 0}
				<div
					class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center"
				>
					<p class="text-sm font-medium">No definitions found</p>
					<p class="text-muted-foreground mt-1 text-xs">
						{searchQuery
							? 'Try adjusting your search'
							: 'Add your first definition to get started'}
					</p>
				</div>
			{:else if viewMode === 'grid'}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each filtered as record (record.guid)}
						<DefinitionGridCard {record} onOpen={(r) => (drawerRecord = r)} />
					{/each}
				</div>
			{:else}
				<DefinitionListView
					records={filtered}
					projects={data.projects}
					onOpen={(r) => (drawerRecord = r)}
				/>
			{/if}
		</div>
	</div>
</div>

{#if drawerRecord}
	<DefinitionDetailDrawer
		record={drawerRecord}
		projectName={projectName(drawerRecord.projectId)}
		onClose={() => (drawerRecord = null)}
		onEdit={(r) => {
			editingDefinitionId = r.guid;
			drawerRecord = null;
		}}
		onOpenRunner={(guid) => goto(`/app/${guid}`)}
	/>
{/if}

{#if editingRecord}
	<DefinitionEditDrawer
		record={editingRecord}
		projects={data.projects}
		computeServers={data.computeServers}
		isSaving={savingDefinitionId === editingRecord.guid}
		onClose={() => (editingDefinitionId = null)}
		onSave={saveDefinition}
		onDelete={deleteDefinition}
	/>
{/if}

{#if editingProject && data.canManageProjects}
	<ProjectSettingsDialog
		project={editingProject}
		users={data.users}
		open={editingProjectId !== null}
		onOpenChange={(o) => {
			if (!o) editingProjectId = null;
		}}
		onSave={saveProject}
		onDelete={(id) => (deletingProjectId = id)}
		onAddMember={addMember}
		onUpdateMemberRole={updateMemberRole}
		onRemoveMember={removeMember}
	/>
{/if}

<AlertDialog.Root
	open={deletingProjectId !== null}
	onOpenChange={(o) => {
		if (!o) deletingProjectId = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete "{deletingProject?.name ?? ''}"?</AlertDialog.Title>
			<AlertDialog.Description>
				This will remove the project and all member assignments. Definitions will become unassigned.
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

<AddDefinitionDialog
	open={showAddModal}
	isAdding={addingDefinition}
	projects={data.projects}
	defaultProjectId={activeProjectId ?? data.projects[0]?.id}
	computeServers={data.computeServers}
	showProjectDropdown={data.projects.length > 1}
	onOpenChange={(o) => (showAddModal = o)}
	onSubmit={submitAddDefinition}
/>
