<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import {
		Button,
		Separator,
		toast,
		Badge,
		Input,
		Label,
		Textarea,
		AlertDialog
	} from 'selva-shared';
	import {
		Plus,
		Grid2x2,
		List,
		X,
		Play,
		Ellipsis,
		Users,
		Settings,
		UserPlus,
		Trash2,
		Search,
		Upload,
		Image
	} from '@lucide/svelte';
	import AddDefinitionDialog from '../admin/definitions/AddDefinitionDialog.svelte';
	import FileUploadField from '../admin/definitions/FileUploadField.svelte';
	import ImageUploadField from '../admin/definitions/ImageUploadField.svelte';
	import type {
		DefinitionRecord,
		ProjectWithMembers,
		ComputeServerConfig,
		AuthUser
	} from './+page.server.js';
	import type { DefinitionStatus } from '@selva/platform';
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

	// ── View state ────────────────────────────────────────────────────────────
	type MainTab = 'definitions' | 'members';
	let mainTab = $state<MainTab>('definitions');
	let searchQuery = $state('');
	let activeProjectId = $state<string | null>(null);
	let viewMode = $state<'grid' | 'list'>('grid');
	let drawerRecord = $state<DefinitionRecord | null>(null);
	let showAddModal = $state(false);
	let addingDefinition = $state(false);
	let editingDefinition = $state<string | null>(null);
	let savingDefinition = $state<Record<string, boolean>>({});

	// ── Edit drawer state ─────────────────────────────────────────────────────
	let editDisplayName = $state('');
	let editDescription = $state('');
	let editCategory = $state('');
	let editTags = $state<string[]>([]);
	let editProjectId = $state('');
	let editComputeServerId = $state<string | null>(null);
	let editStatus = $state<DefinitionStatus>('draft');
	let editMaxHistory = $state<number | undefined>(undefined);
	let editUserImageMode = $state<'url' | 'upload' | undefined>(undefined);
	let editCoverImageUrl = $state('');
	let editImageInput = $state<HTMLInputElement>();
	let editImageHasFile = $state(false);
	let editFileInput = $state<HTMLInputElement>();
	let editFileHasFile = $state(false);
	let showDeleteConfirm = $state(false);
	let showFileUploadConfirm = $state(false);
	let uploadingFile = $state(false);
	let uploadingImage = $state(false);

	function openEditDrawer(record: DefinitionRecord) {
		editDisplayName = record.meta.displayName;
		editDescription = record.meta.description ?? '';
		editCategory = record.meta.category ?? '';
		editTags = [...(record.meta.tags ?? [])];
		editStatus = record.status as DefinitionStatus;
		editProjectId = record.projectId;
		editComputeServerId = record.computeServerId ?? null;
		editMaxHistory = record.maxHistory > 0 ? record.maxHistory : undefined;
		editUserImageMode = undefined;
		editCoverImageUrl = record.meta.coverImage ?? '';
		editImageHasFile = false;
		editFileHasFile = false;
		editingDefinition = record.guid;
	}

	function closeEditDrawer() {
		editingDefinition = null;
		showDeleteConfirm = false;
		showFileUploadConfirm = false;
	}

	async function confirmDelete() {
		if (!editingRecord) return;
		const name = editingRecord.meta.displayName;
		try {
			const res = await fetch(`/admin/api/definitions/${editingRecord.guid}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success(`"${name}" deleted`);
				closeEditDrawer();
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Delete failed');
			}
		} catch {
			toast.error('Delete failed');
		} finally {
			showDeleteConfirm = false;
		}
	}

	async function confirmFileUpload() {
		if (!editFileInput?.files?.length || !editingRecord) return;
		uploadingFile = true;
		const formData = new FormData();
		formData.append('file', editFileInput.files[0]);
		formData.append('guid', editingRecord.guid);
		try {
			const res = await fetch('/admin/api/definitions/upload', { method: 'POST', body: formData });
			if (res.ok) {
				const result = await res.json();
				toast.success(`"${result.filename}" uploaded`);
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Upload failed');
			}
		} catch {
			toast.error('Upload failed');
		} finally {
			uploadingFile = false;
			showFileUploadConfirm = false;
			if (editFileInput) editFileInput.value = '';
			editFileHasFile = false;
		}
	}

	async function handleImageUpload() {
		if (!editImageInput?.files?.length || !editingRecord) return;
		uploadingImage = true;
		const formData = new FormData();
		formData.append('image', editImageInput.files[0]);
		try {
			const res = await fetch(`/admin/api/definitions/${editingRecord.guid}/image`, {
				method: 'POST',
				body: formData
			});
			if (res.ok) {
				toast.success('Cover image updated');
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Image upload failed');
			}
		} catch {
			toast.error('Image upload failed');
		} finally {
			uploadingImage = false;
			if (editImageInput) editImageInput.value = '';
			editImageHasFile = false;
		}
	}

	// Members panel state
	let addMemberProjectId = $state<string | null>(null);
	let newMemberUserId = $state('');
	let newMemberRole = $state<ProjectRole>('viewer');
	let addingMember = $state(false);
	let removingMember = $state<string | null>(null);
	let editingProjectId = $state<string | null>(null);
	let editProjectName = $state('');
	let editProjectDescription = $state('');
	let editProjectVisibility = $state<ProjectVisibility>('public');
	let savingProject = $state(false);
	let deletingProjectId = $state<string | null>(null);
	let showAddProjectForm = $state(false);
	let newProjectName = $state('');
	let newProjectDescription = $state('');
	let newProjectVisibility = $state<ProjectVisibility>('public');
	let addingProject = $state(false);

	$effect(() => {
		if (data.projects.length > 0 && activeProjectId === null) {
			activeProjectId = data.projects[0]?.id ?? null;
		}
	});

	// ── Derived ───────────────────────────────────────────────────────────────
	const filtered = $derived.by(() => {
		let records = data.records;
		if (activeProjectId) records = records.filter((r) => r.projectId === activeProjectId);
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			records = records.filter(
				(r) =>
					r.meta.displayName?.toLowerCase().includes(q) ||
					r.meta.description?.toLowerCase().includes(q) ||
					r.meta.tags?.some((t) => t.toLowerCase().includes(q))
			);
		}
		return records;
	});

	const editingRecord = $derived(
		editingDefinition ? (data.records.find((r) => r.guid === editingDefinition) ?? null) : null
	);

	const editImageMode = $derived<'url' | 'upload'>(
		editUserImageMode ??
			(editingRecord?.meta.coverImage?.startsWith('/api/definitions/') ? 'upload' : 'url')
	);

	const activeProject = $derived(
		activeProjectId ? (data.projects.find((p) => p.id === activeProjectId) ?? null) : null
	);

	function projectName(id: string) {
		return data.projects.find((p) => p.id === id)?.name ?? '';
	}

	// ── Status styles ─────────────────────────────────────────────────────────
	const STATUS_RING: Record<string, string> = {
		draft: 'bg-muted text-muted-foreground border-border',
		review:
			'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/30 dark:text-yellow-400 dark:border-yellow-800',
		published:
			'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400 dark:border-green-800',
		archived: 'bg-muted text-muted-foreground border-border opacity-60',
		pending: 'bg-muted text-muted-foreground border-border'
	};
	const STATUS_DOT: Record<string, string> = {
		draft: 'bg-muted-foreground',
		review: 'bg-yellow-500',
		published: 'bg-green-500',
		archived: 'bg-muted-foreground',
		pending: 'bg-muted-foreground'
	};
	const statusRing = (s: string) => STATUS_RING[s] ?? STATUS_RING.draft;
	const statusDot = (s: string) => STATUS_DOT[s] ?? STATUS_DOT.draft;

	// Project color: deterministic from ID
	const PROJECT_COLORS = ['#4f7c4f', '#4f6a7c', '#7c4f4f', '#7c6a4f', '#6a4f7c', '#4f7c6a'];
	function projectColor(id: string) {
		let h = 0;
		for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
		return PROJECT_COLORS[Math.abs(h) % PROJECT_COLORS.length];
	}

	function formatUpdated(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 60) return `${mins}m`;
		const h = Math.floor(mins / 60);
		if (h < 24) return `${h}h`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}d`;
		return `${Math.floor(d / 7)}w`;
	}

	function userLabel(userId: string) {
		const u = data.users.find((u) => u.id === userId);
		return u?.displayName ?? u?.email ?? userId.slice(0, 8);
	}

	function availableUsers(project: ProjectWithMembers) {
		const ids = new Set(project.members.map((m) => m.userId));
		return data.users.filter((u) => !ids.has(u.id));
	}

	// ── API helpers ───────────────────────────────────────────────────────────
	async function getErrorMessage(res: Response, fallback: string) {
		if (res.headers.get('content-type')?.includes('application/json')) {
			const e = await res.json().catch(() => null);
			return e?.message || e?.error?.message || `${fallback} (${res.status})`;
		}
		return `${fallback} (${res.status})`;
	}

	async function saveDefinition(
		guid: string,
		patch: Partial<DefinitionRecord['meta']> & {
			maxHistory?: number;
			projectId?: string;
			computeServerId?: string | null;
			status?: DefinitionStatus;
		}
	) {
		savingDefinition[guid] = true;
		try {
			const res = await fetch(`/admin/api/definitions/${guid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(patch)
			});
			if (res.ok) {
				toast.success('Definition saved');
				editingDefinition = null;
				drawerRecord = null;
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(res, 'Save failed'));
			}
		} catch (e) {
			toast.error('Save failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
		} finally {
			savingDefinition[guid] = false;
		}
	}

	async function submitAddDefinition(formData: FormData) {
		addingDefinition = true;
		try {
			const res = await fetch('/admin/api/definitions', { method: 'POST', body: formData });
			if (res.ok) {
				toast.success(`"${formData.get('displayName')}" created`);
				showAddModal = false;
				await invalidateAll();
			} else {
				const msg = await getErrorMessage(res, 'Failed to create definition');
				toast.error(msg);
				throw new Error(msg);
			}
		} catch (e) {
			if (!(e instanceof Error && e.message)) {
				toast.error('Failed: ' + (e instanceof Error ? e.message : 'Unknown error'));
			}
			throw e;
		} finally {
			addingDefinition = false;
		}
	}

	// ── Project API ───────────────────────────────────────────────────────────
	async function addProject() {
		if (!newProjectName.trim()) return;
		addingProject = true;
		try {
			const res = await fetch('/admin/api/projects', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: newProjectName,
					description: newProjectDescription,
					visibility: newProjectVisibility
				})
			});
			if (res.ok) {
				toast.success(`Project "${newProjectName}" created`);
				newProjectName = '';
				newProjectDescription = '';
				newProjectVisibility = 'public';
				showAddProjectForm = false;
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Failed to create project');
			}
		} catch {
			toast.error('Failed to create project');
		} finally {
			addingProject = false;
		}
	}

	function startEditProject(p: ProjectWithMembers) {
		editingProjectId = p.id;
		editProjectName = p.name;
		editProjectDescription = p.description ?? '';
		editProjectVisibility = p.visibility;
	}

	async function saveProject(id: string) {
		savingProject = true;
		try {
			const res = await fetch(`/admin/api/projects/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: editProjectName,
					description: editProjectDescription,
					visibility: editProjectVisibility
				})
			});
			if (res.ok) {
				toast.success('Project saved');
				editingProjectId = null;
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Failed');
			}
		} catch {
			toast.error('Failed to save');
		} finally {
			savingProject = false;
		}
	}

	async function deleteProject(id: string) {
		try {
			const res = await fetch(`/admin/api/projects/${id}`, { method: 'DELETE' });
			if (res.ok) {
				toast.success('Project deleted');
				if (activeProjectId === id) activeProjectId = data.projects[0]?.id ?? null;
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Failed');
			}
		} catch {
			toast.error('Failed to delete');
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
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ userId: newMemberUserId, role: newMemberRole })
			});
			if (res.ok) {
				toast.success('Member added');
				newMemberUserId = '';
				newMemberRole = 'viewer';
				addMemberProjectId = null;
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Failed');
			}
		} catch {
			toast.error('Failed');
		} finally {
			addingMember = false;
		}
	}

	async function updateMemberRole(projectId: string, userId: string, role: ProjectRole) {
		try {
			const res = await fetch(`/admin/api/projects/${projectId}/members/${userId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role })
			});
			if (res.ok) await invalidateAll();
			else toast.error('Failed to update role');
		} catch {
			toast.error('Failed');
		}
	}

	async function removeMember(projectId: string, userId: string) {
		removingMember = `${projectId}:${userId}`;
		try {
			const res = await fetch(`/admin/api/projects/${projectId}/members/${userId}`, {
				method: 'DELETE'
			});
			if (res.ok) await invalidateAll();
			else toast.error('Failed to remove member');
		} catch {
			toast.error('Failed');
		} finally {
			removingMember = null;
		}
	}
</script>

<svelte:head>
	<title>Definitions – Selva</title>
</svelte:head>

<!-- ── Two-pane layout ──────────────────────────────────────────────────────── -->
<div class="flex h-[calc(100vh-3.5rem)] overflow-hidden">
	<!-- ── Left sidebar: Projects ──────────────────────────────────────────── -->
	<aside class="border-border bg-background flex w-56 shrink-0 flex-col overflow-y-auto border-r">
		<!-- Projects header -->
		<div class="flex items-center justify-between px-4 pt-5 pb-2">
			<span class="text-muted-foreground font-mono text-[10px] tracking-widest uppercase"
				>Projects</span
			>
			{#if data.canManageProjects}
				<button
					onclick={() => (showAddProjectForm = !showAddProjectForm)}
					class="text-muted-foreground hover:text-foreground rounded p-0.5 transition-colors"
					title="New project"
				>
					<Plus class="h-3.5 w-3.5" />
				</button>
			{/if}
		</div>

		<!-- Add project inline form -->
		{#if showAddProjectForm && data.canManageProjects}
			<div class="border-border bg-muted/40 mx-3 mb-2 space-y-2 rounded-lg border p-3">
				<input
					bind:value={newProjectName}
					placeholder="Project name"
					class="border-border bg-background focus:ring-ring w-full rounded-md border px-2.5 py-1.5 text-xs outline-none focus:ring-1"
				/>
				<select
					bind:value={newProjectVisibility}
					class="border-border bg-background w-full rounded-md border px-2.5 py-1.5 text-xs outline-none"
				>
					<option value="public">Public</option>
					<option value="org">Org</option>
					<option value="private">Private</option>
				</select>
				<div class="flex gap-1.5">
					<Button
						onclick={addProject}
						disabled={addingProject || !newProjectName.trim()}
						size="sm"
						class="h-6 flex-1 text-xs"
					>
						{addingProject ? '…' : 'Create'}
					</Button>
					<Button
						onclick={() => (showAddProjectForm = false)}
						variant="ghost"
						size="sm"
						class="h-6 px-2 text-xs"
					>
						<X class="h-3 w-3" />
					</Button>
				</div>
			</div>
		{/if}

		<!-- Project list -->
		<nav class="flex-1 px-2 pb-4">
			{#each data.projects as project (project.id)}
				{@const isActive = activeProjectId === project.id}
				{@const defCount = data.records.filter((r) => r.projectId === project.id).length}
				<button
					onclick={() => {
						activeProjectId = project.id;
						mainTab = 'definitions';
					}}
					class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors
						{isActive
						? 'bg-muted text-foreground'
						: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'}"
				>
					<!-- Color dot -->
					<span
						class="h-4 w-4 shrink-0 rounded"
						style="background-color: {projectColor(project.id)}"
					></span>
					<span class="flex-1 truncate text-sm font-medium">{project.name}</span>
					<span class="shrink-0 font-mono text-[11px] opacity-60">{defCount}</span>
				</button>
			{/each}

			{#if data.projects.length === 0}
				<p class="text-muted-foreground px-2 py-4 text-center text-xs">No projects yet</p>
			{/if}
		</nav>
	</aside>

	<!-- ── Main content area ──────────────────────────────────────────────── -->
	<div class="flex flex-1 flex-col overflow-hidden">
		<!-- Page header -->
		<div class="border-border bg-background shrink-0 border-b px-6 pt-6 pb-0">
			<div class="flex items-end justify-between gap-4 pb-4">
				<div>
					{#if activeProject}
						<p class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
							{activeProject.name}
						</p>
					{/if}
					<h1 class="mt-1.5 text-2xl font-semibold tracking-tight">
						{mainTab === 'members' ? 'Members' : 'Definitions'}
					</h1>
				</div>
				<div class="flex shrink-0 items-center gap-2 pb-0.5">
					{#if data.canManageProjects && activeProject}
						<Button
							variant="outline"
							size="sm"
							onclick={() => {
								mainTab = mainTab === 'members' ? 'definitions' : 'members';
							}}
							class="gap-1.5"
						>
							{#if mainTab === 'members'}
								<List class="h-3.5 w-3.5" /> Definitions
							{:else}
								<Users class="h-3.5 w-3.5" /> Members
							{/if}
						</Button>
						{#if mainTab === 'definitions'}
							<Button
								variant="outline"
								size="sm"
								onclick={() => activeProject && startEditProject(activeProject)}
								class="gap-1.5"
							>
								<Settings class="h-3.5 w-3.5" /> Settings
							</Button>
						{/if}
					{/if}
					{#if mainTab === 'definitions'}
						<Button size="sm" onclick={() => (showAddModal = true)} class="gap-1.5">
							<Plus class="h-3.5 w-3.5" /> Add definition
						</Button>
					{/if}
				</div>
			</div>

			<!-- Toolbar (definitions only) -->
			{#if mainTab === 'definitions'}
				<div class="flex items-center justify-end gap-2 pb-2">
					<div class="border-border flex overflow-hidden rounded-lg border">
						<button
							onclick={() => (viewMode = 'grid')}
							class="p-1.5 transition-colors {viewMode === 'grid'
								? 'bg-muted'
								: 'bg-card hover:bg-muted/60'}"
							title="Grid view"><Grid2x2 class="h-3.5 w-3.5" /></button
						>
						<button
							onclick={() => (viewMode = 'list')}
							class="border-border border-l p-1.5 transition-colors {viewMode === 'list'
								? 'bg-muted'
								: 'bg-card hover:bg-muted/60'}"
							title="List view"><List class="h-3.5 w-3.5" /></button
						>
					</div>
				</div>
			{/if}
		</div>

		<!-- ── Tab: Definitions ─────────────────────────────────────────────── -->
		{#if mainTab === 'definitions'}
			<div class="flex-1 overflow-y-auto px-6 py-5">
				<!-- Search -->
				<div class="mb-5 flex items-center gap-3">
					<div
						class="border-border bg-card relative max-w-lg flex-1 overflow-hidden rounded-lg border"
					>
						<Search class="text-muted-foreground absolute top-2.5 left-2.5 h-4 w-4" />
						<input
							bind:value={searchQuery}
							placeholder="Search by name, description, tags…"
							class="w-full bg-transparent py-2 pr-3 pl-9 text-sm outline-none"
						/>
					</div>
					<span class="text-muted-foreground font-mono text-[12px]">
						{filtered.length} definition{filtered.length === 1 ? '' : 's'}
					</span>
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
							<button
								onclick={() => (drawerRecord = record)}
								class="group border-border bg-card cursor-pointer overflow-hidden rounded-xl border text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)]"
							>
								<div class="border-border bg-muted relative aspect-4/3 overflow-hidden border-b">
									{#if record.meta.coverImage}
										<img
											src={record.meta.coverImage}
											alt={record.meta.displayName}
											class="absolute inset-0 h-full w-full object-cover"
										/>
									{/if}
									<div class="absolute top-2.5 left-2.5">
										<span
											class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wide {statusRing(
												record.status
											)}"
										>
											<span class="h-1.5 w-1.5 rounded-full {statusDot(record.status)}"></span>
											{record.status}
										</span>
									</div>
								</div>
								<div class="p-3.5">
									<p class="truncate text-[13.5px] font-semibold">{record.meta.displayName}</p>
									{#if record.meta.description}
										<p
											class="text-muted-foreground mt-1 line-clamp-2 text-[12.5px] leading-relaxed"
										>
											{record.meta.description}
										</p>
									{/if}
									{#if record.meta.tags?.length}
										<div class="mt-2.5 flex flex-wrap gap-1">
											{#each record.meta.tags.slice(0, 3) as tag (tag)}
												<span
													class="bg-muted text-muted-foreground rounded px-1.5 py-px font-mono text-[10.5px]"
													>#{tag}</span
												>
											{/each}
										</div>
									{/if}
									<Separator class="my-3" />
									<div
										class="text-muted-foreground flex items-center justify-between font-mono text-[11.5px]"
									>
										<span>{formatUpdated(record.updatedAt)} ago</span>
										<span>{record.runCount.toLocaleString()} runs</span>
									</div>
								</div>
							</button>
						{/each}
					</div>
				{:else}
					<!-- List view -->
					<div class="border-border bg-card overflow-hidden rounded-xl border">
						<div
							class="border-border bg-muted/50 text-muted-foreground grid border-b px-4 py-2.5 font-mono text-[10.5px] tracking-widest uppercase"
							style="grid-template-columns: 1.6fr 0.9fr 0.8fr 0.7fr 0.6fr 36px"
						>
							<span>Definition</span><span>Project</span><span>Status</span><span>Updated</span>
							<span class="text-right">Runs</span><span></span>
						</div>
						{#each filtered as record, i (record.guid)}
							<button
								onclick={() => (drawerRecord = record)}
								class="hover:bg-muted/50 grid w-full items-center px-4 py-3.5 text-left text-[13px] transition-colors
									{i < filtered.length - 1 ? 'border-border border-b' : ''}"
								style="grid-template-columns: 1.6fr 0.9fr 0.8fr 0.7fr 0.6fr 36px"
							>
								<span>
									<span class="font-semibold">{record.meta.displayName}</span>
									{#if record.meta.description}
										<span class="text-muted-foreground ml-2 text-[12px]">
											{record.meta.description.slice(0, 60)}{record.meta.description.length > 60
												? '…'
												: ''}
										</span>
									{/if}
								</span>
								<span class="text-muted-foreground">{projectName(record.projectId)}</span>
								<span>
									<span
										class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wide {statusRing(
											record.status
										)}"
									>
										<span class="h-1.5 w-1.5 rounded-full {statusDot(record.status)}"></span>
										{record.status}
									</span>
								</span>
								<span class="text-muted-foreground font-mono text-[12px]"
									>{formatUpdated(record.updatedAt)}</span
								>
								<span class="text-right font-mono text-[12px]"
									>{record.runCount.toLocaleString()}</span
								>
								<span class="flex justify-end"
									><Ellipsis class="text-muted-foreground h-4 w-4" /></span
								>
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- ── Tab: Members ─────────────────────────────────────────────────── -->
		{:else if mainTab === 'members' && activeProject}
			<div class="flex-1 overflow-y-auto px-6 py-5">
				<div class="max-w-2xl space-y-4">
					<!-- Members list -->
					{#if activeProject.members.length === 0 && !addMemberProjectId}
						<div
							class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-14 text-center"
						>
							<Users class="text-muted-foreground mb-3 h-8 w-8" />
							<p class="text-sm font-medium">No members yet</p>
							<p class="text-muted-foreground mt-1 text-xs">
								Add members to control who can edit this project.
							</p>
						</div>
					{:else}
						<div class="border-border bg-card overflow-hidden rounded-xl border">
							{#each activeProject.members as member (`${member.projectId}:${member.userId}`)}
								<div class="border-border flex items-center gap-3 border-b px-4 py-3 last:border-0">
									<div
										class="bg-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold"
									>
										{userLabel(member.userId)[0]?.toUpperCase() ?? '?'}
									</div>
									<span class="flex-1 truncate text-sm">{userLabel(member.userId)}</span>
									<select
										value={member.role}
										onchange={(e) =>
											updateMemberRole(
												activeProject.id,
												member.userId,
												(e.target as HTMLSelectElement).value as ProjectRole
											)}
										class="border-border bg-background rounded-md border px-2 py-1 text-xs outline-none"
									>
										<option value="owner">Owner</option>
										<option value="editor">Editor</option>
										<option value="viewer">Viewer</option>
									</select>
									<Button
										onclick={() => removeMember(activeProject.id, member.userId)}
										disabled={removingMember === `${activeProject.id}:${member.userId}`}
										variant="ghost"
										size="icon"
										class="text-muted-foreground hover:text-destructive h-7 w-7"
										><X class="h-3.5 w-3.5" /></Button
									>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Add member form -->
					{#if addMemberProjectId === activeProject.id}
						<div class="border-border bg-card flex items-center gap-2 rounded-xl border p-3">
							<select
								bind:value={newMemberUserId}
								class="border-border bg-background min-w-0 flex-1 rounded-md border px-2.5 py-1.5 text-sm outline-none"
							>
								<option value="">Select user…</option>
								{#each availableUsers(activeProject) as u (u.id)}
									<option value={u.id}>{u.email ?? u.id}</option>
								{/each}
							</select>
							<select
								bind:value={newMemberRole}
								class="border-border bg-background rounded-md border px-2.5 py-1.5 text-sm outline-none"
							>
								<option value="owner">Owner</option>
								<option value="editor">Editor</option>
								<option value="viewer">Viewer</option>
							</select>
							<Button
								onclick={() => addMember(activeProject.id)}
								disabled={addingMember || !newMemberUserId}
								size="sm"
							>
								{addingMember ? '…' : 'Add'}
							</Button>
							<Button
								onclick={() => (addMemberProjectId = null)}
								variant="ghost"
								size="icon"
								class="text-muted-foreground h-8 w-8"><X class="h-4 w-4" /></Button
							>
						</div>
					{:else}
						<Button
							onclick={() => {
								addMemberProjectId = activeProject.id;
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
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- ── Definition drawer ────────────────────────────────────────────────────── -->
{#if drawerRecord}
	{@const rec = drawerRecord}
	<div
		role="button"
		tabindex="-1"
		class="fixed inset-0 z-50 bg-black/30"
		onclick={() => (drawerRecord = null)}
		onkeydown={(e) => e.key === 'Escape' && (drawerRecord = null)}
	></div>
	<div
		class="border-border bg-background animate-in slide-in-from-right-4 fixed top-0 right-0 z-50 flex h-full w-125 flex-col overflow-y-auto border-l duration-150"
	>
		<div class="border-border flex items-start justify-between gap-4 border-b p-6">
			<div>
				<div class="flex items-center gap-2">
					<span
						class="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[11px] tracking-wide {statusRing(
							rec.status
						)}"
					>
						<span class="h-1.5 w-1.5 rounded-full {statusDot(rec.status)}"></span>
						{rec.status}
					</span>
					<span class="text-muted-foreground font-mono text-[11px] tracking-wide uppercase">
						{projectName(rec.projectId)}
					</span>
				</div>
				<h2 class="mt-2.5 text-xl font-semibold tracking-tight">{rec.meta.displayName}</h2>
				{#if rec.meta.description}
					<p class="text-muted-foreground mt-1 text-[13.5px]">{rec.meta.description}</p>
				{/if}
			</div>
			<Button
				variant="ghost"
				size="icon"
				onclick={() => (drawerRecord = null)}
				class="mt-0.5 h-8 w-8 shrink-0"
			>
				<X class="h-4 w-4" />
			</Button>
		</div>

		<div class="flex-1 space-y-5 p-6">
			{#if rec.meta.coverImage}
				<img
					src={rec.meta.coverImage}
					alt={rec.meta.displayName}
					class="border-border aspect-4/3 w-full rounded-xl border object-cover"
				/>
			{:else}
				<div
					class="border-border bg-muted flex aspect-[4/3] w-full items-center justify-center rounded-xl border"
				>
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase"
						>No preview</span
					>
				</div>
			{/if}

			<div class="flex gap-2">
				<Button class="flex-1" onclick={() => goto(`/app/${rec.guid}`)}>
					<Play class="h-3.5 w-3.5" /> Open runner
				</Button>
				<Button
					variant="outline"
					onclick={() => {
						openEditDrawer(rec);
						drawerRecord = null;
					}}
				>
					Edit
				</Button>
			</div>

			<Separator />

			<div class="grid grid-cols-2 gap-4">
				<div>
					<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
						Updated
					</p>
					<p class="mt-1 text-[13.5px]">{formatUpdated(rec.updatedAt)} ago</p>
				</div>
				<div>
					<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
						Runs
					</p>
					<p class="mt-1 text-[13.5px]">{rec.runCount.toLocaleString()}</p>
				</div>
				<div>
					<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
						File
					</p>
					<p class="text-muted-foreground mt-1 font-mono text-[12px]">
						{rec.originalFilename ?? `definition.${rec.fileExt}`}
					</p>
				</div>
				{#if rec.meta.category}
					<div>
						<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
							Category
						</p>
						<p class="mt-1 text-[13.5px]">{rec.meta.category}</p>
					</div>
				{/if}
			</div>

			{#if rec.meta.tags?.length}
				<div>
					<Separator class="mb-4" />
					<p class="text-muted-foreground mb-2.5 font-mono text-[10.5px] tracking-widest uppercase">
						Tags
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each rec.meta.tags as tag (tag)}
							<span class="bg-muted text-muted-foreground rounded px-2 py-0.5 font-mono text-[11px]"
								>#{tag}</span
							>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- ── Project settings modal ───────────────────────────────────────────────── -->
{#if editingProjectId && data.canManageProjects}
	{@const proj = data.projects.find((p) => p.id === editingProjectId)}
	{#if proj}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
			<div
				class="border-border bg-background w-full max-w-md space-y-5 rounded-xl border p-6 shadow-xl"
			>
				<div class="flex items-center justify-between">
					<h3 class="text-base font-semibold">Project settings</h3>
					<Button
						variant="ghost"
						size="icon"
						onclick={() => (editingProjectId = null)}
						class="h-7 w-7"
					>
						<X class="h-4 w-4" />
					</Button>
				</div>
				<div class="space-y-3">
					<div class="space-y-1.5">
						<label
							for="edit-proj-name"
							class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase"
							>Name</label
						>
						<input
							id="edit-proj-name"
							bind:value={editProjectName}
							class="border-border bg-background focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
						/>
					</div>
					<div class="space-y-1.5">
						<label
							for="edit-proj-desc"
							class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase"
							>Description</label
						>
						<textarea
							id="edit-proj-desc"
							bind:value={editProjectDescription}
							rows={2}
							class="border-border bg-background focus:ring-ring w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1"
						></textarea>
					</div>
					<div class="space-y-1.5">
						<label
							for="edit-proj-vis"
							class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase"
							>Visibility</label
						>
						<select
							id="edit-proj-vis"
							bind:value={editProjectVisibility}
							class="border-border bg-background w-full rounded-lg border px-3 py-2 text-sm outline-none"
						>
							<option value="public">Public — any authenticated user can solve</option>
							<option value="org">Org — any org member can solve</option>
							<option value="private">Private — only project members can solve</option>
						</select>
					</div>
				</div>
				<div class="flex items-center justify-between">
					<Button
						onclick={() => (deletingProjectId = proj.id)}
						variant="ghost"
						size="sm"
						class="text-destructive hover:text-destructive gap-1.5 px-2"
					>
						<Trash2 class="h-3.5 w-3.5" /> Delete project
					</Button>
					<div class="flex gap-2">
						<Button onclick={() => (editingProjectId = null)} variant="outline" size="sm"
							>Cancel</Button
						>
						<Button onclick={() => saveProject(proj.id)} disabled={savingProject} size="sm">
							{savingProject ? 'Saving…' : 'Save'}
						</Button>
					</div>
				</div>
			</div>
		</div>
	{/if}
{/if}

<!-- ── Delete project confirm ───────────────────────────────────────────────── -->
{#if deletingProjectId}
	{@const proj = data.projects.find((p) => p.id === deletingProjectId)}
	<div class="fixed inset-0 z-60 flex items-center justify-center bg-black/40">
		<div
			class="border-border bg-background w-full max-w-sm space-y-4 rounded-xl border p-6 shadow-xl"
		>
			<h3 class="text-base font-semibold">Delete "{proj?.name}"?</h3>
			<p class="text-muted-foreground text-sm">
				This will remove the project and all member assignments. Definitions will become unassigned.
			</p>
			<div class="flex justify-end gap-2">
				<Button onclick={() => (deletingProjectId = null)} variant="outline" size="sm"
					>Cancel</Button
				>
				<Button
					onclick={() => deletingProjectId && deleteProject(deletingProjectId)}
					variant="destructive"
					size="sm">Delete</Button
				>
			</div>
		</div>
	</div>
{/if}

<!-- ── Edit drawer ───────────────────────────────────────────────────────────── -->
{#if editingDefinition && editingRecord}
	{@const rec = editingRecord}
	<!-- Backdrop -->
	<div
		role="button"
		tabindex="-1"
		class="fixed inset-0 z-50 bg-black/30"
		onclick={closeEditDrawer}
		onkeydown={(e) => e.key === 'Escape' && closeEditDrawer()}
	></div>
	<!-- Panel -->
	<div
		class="border-border bg-background animate-in slide-in-from-right-4 fixed top-0 right-0 z-50 flex h-full w-125 flex-col border-l duration-150"
	>
		<!-- Header -->
		<div class="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
			<div>
				<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
					Editing
				</p>
				<h2 class="mt-0.5 text-base font-semibold">{rec.meta.displayName}</h2>
			</div>
			<Button variant="ghost" size="icon" onclick={closeEditDrawer} class="h-8 w-8 shrink-0">
				<X class="h-4 w-4" />
			</Button>
		</div>

		<!-- Scrollable body -->
		<div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
			<!-- Name -->
			<div class="space-y-1.5">
				<Label for="edit-name">Display name</Label>
				<Input id="edit-name" bind:value={editDisplayName} />
			</div>

			<!-- Description -->
			<div class="space-y-1.5">
				<Label for="edit-desc">Description</Label>
				<Textarea id="edit-desc" rows={3} bind:value={editDescription} />
			</div>

			<!-- Status -->
			<div class="space-y-1.5">
				<Label for="edit-status">Status</Label>
				<select
					id="edit-status"
					bind:value={editStatus}
					class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
				>
					<option value="draft">Draft — work in progress</option>
					<option value="review">Review — submitted for review</option>
					<option value="published">Published — live and visible to runners</option>
					<option value="archived">Archived — retired, hidden from runners</option>
				</select>
			</div>

			<!-- Category + Tags -->
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="edit-cat">Category</Label>
					<Input id="edit-cat" maxlength={40} bind:value={editCategory} placeholder="e.g. Facade" />
				</div>
				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<Label for="edit-tags">Tags</Label>
						<span class="text-muted-foreground text-xs">{editTags.length}/5</span>
					</div>
					{#if editTags.length > 0}
						<div class="mb-1 flex flex-wrap gap-1">
							{#each editTags as tag (tag)}
								<Badge variant="outline" class="gap-1 text-xs">
									{tag}
									<button
										onclick={() => (editTags = editTags.filter((t) => t !== tag))}
										class="hover:opacity-70"
									>
										<X class="h-2.5 w-2.5" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
					<Input
						id="edit-tags"
						placeholder="Add tag + Enter"
						disabled={editTags.length >= 5}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								const el = e.currentTarget as HTMLInputElement;
								const tag = el.value.trim();
								if (tag && !editTags.includes(tag) && editTags.length < 5) {
									editTags = [...editTags, tag];
									el.value = '';
								}
							}
						}}
					/>
				</div>
			</div>

			<Separator />

			<!-- Cover image -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Image class="text-muted-foreground h-4 w-4" />
					<Label>Cover image</Label>
				</div>
				<ImageUploadField
					mode={editImageMode}
					value={rec.meta.coverImage ?? ''}
					isUploading={uploadingImage}
					hasFile={editImageHasFile}
					onModeChange={(m) => (editUserImageMode = m)}
					onUpload={handleImageUpload}
					onFileSelected={() => (editImageHasFile = !!editImageInput?.files?.length)}
					onUrlChange={(url) => (editCoverImageUrl = url)}
					bind:inputRef={editImageInput}
				/>
			</div>

			<!-- GH file -->
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Upload class="text-muted-foreground h-4 w-4" />
					<Label>Grasshopper file</Label>
				</div>
				{#if rec.originalFilename}
					<p class="text-muted-foreground font-mono text-xs">
						Current: {rec.originalFilename}
					</p>
				{/if}
				<FileUploadField
					id="edit-gh-{rec.guid}"
					accept=".gh,.ghx"
					isUploading={uploadingFile}
					hasFile={editFileHasFile}
					onFileSelected={() => (editFileHasFile = !!editFileInput?.files?.length)}
					onUpload={() => (showFileUploadConfirm = true)}
					bind:inputRef={editFileInput}
				/>
			</div>

			<!-- Project / compute server -->
			{#if data.projects.length > 1 || data.computeServers.length > 1}
				<div class="grid grid-cols-2 gap-3">
					{#if data.projects.length > 1}
						<div class="space-y-1.5">
							<Label for="edit-proj">Project</Label>
							<select
								id="edit-proj"
								bind:value={editProjectId}
								class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
							>
								{#each data.projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
							</select>
						</div>
					{/if}
					{#if data.computeServers.length > 1}
						<div class="space-y-1.5">
							<Label for="edit-srv">Compute server</Label>
							<select
								id="edit-srv"
								value={editComputeServerId ?? ''}
								onchange={(e) => {
									editComputeServerId = (e.currentTarget as HTMLSelectElement).value || null;
								}}
								class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
							>
								<option value="">Default</option>
								{#each data.computeServers as s (s.id)}<option value={s.id}>{s.label}</option
									>{/each}
							</select>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Sticky footer -->
		<div class="border-border flex shrink-0 items-center justify-between border-t px-6 py-4">
			<Button
				variant="ghost"
				size="sm"
				onclick={() => (showDeleteConfirm = true)}
				class="text-destructive hover:text-destructive gap-1.5 px-2"
			>
				<Trash2 class="h-3.5 w-3.5" /> Delete
			</Button>
			<div class="flex gap-2">
				<Button variant="outline" size="sm" onclick={closeEditDrawer}>Cancel</Button>
				<Button
					size="sm"
					disabled={savingDefinition[rec.guid]}
					onclick={() =>
						saveDefinition(rec.guid, {
							displayName: editDisplayName,
							description: editDescription || undefined,
							category: editCategory || undefined,
							tags: editTags.length ? editTags : undefined,
							coverImage: editCoverImageUrl || undefined,
							status: editStatus,
							projectId: editProjectId || undefined,
							computeServerId: editComputeServerId,
							maxHistory: editMaxHistory
						})}
				>
					{savingDefinition[rec.guid] ? 'Saving…' : 'Save'}
				</Button>
			</div>
		</div>
	</div>

	<!-- Delete confirm -->
	<AlertDialog.Root open={showDeleteConfirm} onOpenChange={(o) => (showDeleteConfirm = o)}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Delete "{rec.meta.displayName}"?</AlertDialog.Title>
				<AlertDialog.Description
					>This removes the definition and all its files. This cannot be undone.</AlertDialog.Description
				>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirmDelete}>Delete</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<!-- File replace confirm -->
	<AlertDialog.Root open={showFileUploadConfirm} onOpenChange={(o) => (showFileUploadConfirm = o)}>
		<AlertDialog.Content>
			<AlertDialog.Header>
				<AlertDialog.Title>Replace Grasshopper file?</AlertDialog.Title>
				<AlertDialog.Description
					>The current file will be archived. This cannot be undone.</AlertDialog.Description
				>
			</AlertDialog.Header>
			<AlertDialog.Footer>
				<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
				<AlertDialog.Action onclick={confirmFileUpload} disabled={uploadingFile}>
					{uploadingFile ? 'Uploading…' : 'Replace'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</AlertDialog.Content>
	</AlertDialog.Root>
{/if}

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
