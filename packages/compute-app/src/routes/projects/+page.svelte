<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import {
		AlertDialog,
		Button,
		EmptyState,
		Search,
		SectionHeader,
		ViewToggle,
		toast
	} from '@selvajs/ui';
	import { Plus, Settings } from '@lucide/svelte';
	import AddDefinitionDialog from '$lib/components/definitions/AddDefinitionDialog.svelte';
	import ProjectSidebar from './_components/ProjectSidebar.svelte';
	import ProjectSettingsDialog from './_components/ProjectSettingsDialog.svelte';
	import DefinitionCard from '$lib/components/definitions/DefinitionCard.svelte';
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
	import type { ProjectRole, ProjectVisibility } from '@selvajs/platform/projects';

	interface PageData {
		projects: ProjectWithMembers[];
		records: DefinitionRecord[];
		computeServers: ComputeServerConfig[];
		defaultComputeServerId: string | null;
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

	$effect(() => {
		const projectSlug = $page.url.searchParams.get('project');
		if (projectSlug) {
			const project = data.projects.find((p) => p.slug === projectSlug);
			if (project) {
				activeProjectId = project.id;
			}
		}
	});

	// Panels / dialogs
	let drawerRecord = $state<DefinitionRecord | null>(null);
	let editingDefinitionId = $state<string | null>(null);
	let editingProjectId = $state<string | null>(null);
	let deletingProjectId = $state<string | null>(null);
	let showAddModal = $state(false);
	// True when edit was opened from the detail drawer — surfaces a Back link.
	let editCameFromDetail = $state(false);
	let editInitialTab = $state<'versions' | 'details' | 'shares'>('versions');

	// In-flight flags
	let addingDefinition = $state(false);
	let savingDefinitionId = $state<string | null>(null);

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
		editingDefinitionId ? (data.records.find((r) => r.guid === editingDefinitionId) ?? null) : null
	);
	const activeProject = $derived(
		activeProjectId ? (data.projects.find((p) => p.id === activeProjectId) ?? null) : null
	);
	// Show "Add definition" only if the user can upload into the currently scoped
	// project (or into any project, when no project is active). Hides the button
	// for view-only users instead of letting them click into a dead-end dialog.
	const canAddDefinition = $derived(
		activeProject ? activeProject.canEdit : data.projects.some((p) => p.canEdit)
	);
	const editableProjects = $derived(data.projects.filter((p) => p.canEdit));
	const editingProject = $derived(
		editingProjectId ? (data.projects.find((p) => p.id === editingProjectId) ?? null) : null
	);
	const deletingProject = $derived(
		deletingProjectId ? (data.projects.find((p) => p.id === deletingProjectId) ?? null) : null
	);

	function projectName(id: string) {
		return data.projects.find((p) => p.id === id)?.name ?? '';
	}

	function projectVisibility(id: string) {
		return data.projects.find((p) => p.id === id)?.visibility;
	}

	function recordCanEdit(record: DefinitionRecord) {
		return data.projects.find((p) => p.id === record.projectId)?.canEdit ?? false;
	}

	async function errorMessage(res: Response, fallback: string) {
		if (res.headers.get('content-type')?.includes('application/json')) {
			const e = await res.json().catch(() => null);
			return e?.message || e?.error?.message || `${fallback} (${res.status})`;
		}
		return `${fallback} (${res.status})`;
	}

	// ============================================================================
	// Definitions
	// ============================================================================
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

	// ============================================================================
	// Projects
	// ============================================================================
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
			const created = (await res.json().catch(() => null)) as { id: string } | null;
			toast.success(`Project "${p.name}" created`);
			await invalidateAll();
			if (created?.id) activeProjectId = created.id;
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

	// ============================================================================
	// Members
	// ============================================================================
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
	<title>Projects</title>
</svelte:head>

<div class="flex h-full overflow-hidden">
	<ProjectSidebar
		projects={data.projects}
		records={data.records}
		{activeProjectId}
		canManageProjects={data.canManageProjects}
		onSelect={(id) => {
			activeProjectId = id;
			const project = data.projects.find((p) => p.id === id);
			if (project) {
				const params = new URLSearchParams($page.url.search);
				params.set('project', project.slug);
				window.history.replaceState(null, '', `?${params}`);
			}
		}}
		onCreate={createProject}
	/>

	<div class="flex flex-1 flex-col overflow-hidden">
		<div class="border-border bg-background shrink-0 border-b px-(--page-px) py-5">
			<SectionHeader
				class="mb-0"
				eyebrow={activeProject ? activeProject.name : 'All projects'}
				title="Definitions"
				description={activeProject?.description ??
					(!activeProject ? 'Definitions across every project in this organization.' : undefined)}
			>
				{#snippet actions()}
					{#if data.canManageProjects && activeProject}
						<Button
							variant="outline"
							size="sm"
							onclick={() => (editingProjectId = activeProject.id)}
						>
							<Settings class="mr-1.5 h-3.5 w-3.5" />
							Project settings
						</Button>
					{/if}
					{#if canAddDefinition}
						<Button size="sm" onclick={() => (showAddModal = true)}>
							<Plus class="mr-1.5 h-3.5 w-3.5" />
							Add definition
						</Button>
					{/if}
				{/snippet}
			</SectionHeader>
		</div>

		<div class="flex-1 overflow-y-auto px-(--page-px) py-5">
			<div class="mb-5 flex items-center gap-3">
				<div class="max-w-lg flex-1">
					<Search
						bind:value={searchQuery}
						placeholder="Search by name, description, tags…"
						clearable
					/>
				</div>
				<span class="text-muted-foreground font-mono text-xs tabular-nums">
					{filtered.length} definition{filtered.length === 1 ? '' : 's'}
				</span>
				<div class="ml-auto">
					<ViewToggle mode={viewMode} size="sm" onChange={(m) => (viewMode = m)} />
				</div>
			</div>

			{#if filtered.length === 0}
				<EmptyState
					size="lg"
					title="No definitions found"
					description={searchQuery
						? 'Try adjusting your search'
						: 'Add your first definition to get started'}
				/>
			{:else if viewMode === 'grid'}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each filtered as record (record.guid)}
						<DefinitionCard
							{record}
							showStatus
							onOpen={(r) => (drawerRecord = r)}
							projectName={activeProjectId === null ? projectName(record.projectId) : undefined}
							projectVisibility={activeProjectId === null
								? projectVisibility(record.projectId)
								: undefined}
						/>
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
		canEdit={recordCanEdit(drawerRecord)}
		onClose={() => (drawerRecord = null)}
		onEdit={(r) => {
			editInitialTab = 'details';
			editingDefinitionId = r.guid;
			editCameFromDetail = true;
			drawerRecord = null;
		}}
		onShare={(r) => {
			editInitialTab = 'shares';
			editingDefinitionId = r.guid;
			editCameFromDetail = true;
			drawerRecord = null;
		}}
		onOpenRunner={(guid, channel) =>
			goto(`/library/${guid}${channel === 'draft' ? '?channel=draft' : ''}`)}
	/>
{/if}

{#if editingRecord}
	{#key editInitialTab}
		<DefinitionEditDrawer
			record={editingRecord}
			projects={data.projects}
			computeServers={data.computeServers}
			defaultComputeServerId={data.defaultComputeServerId}
			isSaving={savingDefinitionId === editingRecord.guid}
			initialTab={editInitialTab}
			onClose={() => {
				editingDefinitionId = null;
				editCameFromDetail = false;
				editInitialTab = 'versions';
			}}
			onBack={editCameFromDetail
				? () => {
						drawerRecord = editingRecord;
						editingDefinitionId = null;
						editCameFromDetail = false;
					}
				: undefined}
			onSave={saveDefinition}
			onDelete={deleteDefinition}
			onOpenRunner={(guid, channel) =>
				goto(`/library/${guid}${channel === 'draft' ? '?channel=draft' : ''}`)}
		/>
	{/key}
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
		onDelete={(id) => {
			editingProjectId = null;
			deletingProjectId = id;
		}}
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
	projects={editableProjects}
	defaultProjectId={activeProject?.canEdit ? activeProjectId! : editableProjects[0]?.id}
	computeServers={data.computeServers}
	defaultComputeServerId={data.defaultComputeServerId}
	showProjectDropdown={editableProjects.length > 1}
	onOpenChange={(o) => (showAddModal = o)}
	onSubmit={submitAddDefinition}
/>
