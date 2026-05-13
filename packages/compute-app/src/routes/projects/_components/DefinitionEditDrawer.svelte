<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		AlertDialog,
		Badge,
		Button,
		Drawer,
		FilterableDropdown,
		ImageUploadField,
		Input,
		Label,
		Separator,
		Tabs,
		Textarea,
		toast,
		type FilterableDropdownItem
	} from '@selvajs/ui';
	import { ArrowLeft, Image, Trash2, X } from '@lucide/svelte';
	import ProjectPicker from '$lib/components/definitions/ProjectPicker.svelte';
	import type { DefinitionRecord, ProjectWithMembers, ComputeServerConfig } from '../+page.server';
	import type { DefinitionStatus } from '@selvajs/platform';
	import VersionsSection from './VersionsSection.svelte';
	import ShareLinkSection from './ShareLinkSection.svelte';

	export interface EditPatch {
		displayName: string;
		description?: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		status: DefinitionStatus;
		projectId?: string;
		computeServerId: string | null;
	}

	interface Props {
		record: DefinitionRecord;
		projects: ProjectWithMembers[];
		computeServers: ComputeServerConfig[];
		defaultComputeServerId?: string | null;
		isSaving: boolean;
		initialTab?: 'versions' | 'details' | 'shares';
		enableSharing: boolean;
		onClose: () => void;
		onSave: (guid: string, patch: EditPatch) => Promise<void>;
		onDelete: (guid: string) => Promise<void>;
		onOpenRunner: (guid: string, channel?: 'live' | 'draft') => void;
		/** Optional — when set, surfaces a Back link to return to the detail view. */
		onBack?: () => void;
	}

	let {
		record,
		projects,
		computeServers,
		defaultComputeServerId = null,
		isSaving,
		initialTab = 'versions',
		enableSharing,
		onClose,
		onSave,
		onDelete,
		onOpenRunner,
		onBack
	}: Props = $props();

	/* svelte-ignore state_referenced_locally */
	let activeTab = $state<'versions' | 'details' | 'shares'>(
		initialTab === 'shares' && !enableSharing ? 'versions' : initialTab
	);

	// Form state — initialized once from record at mount. The parent unmounts
	// this drawer via {#if editingRecord}, so a new record always gets a fresh
	// component instance.
	/* svelte-ignore state_referenced_locally */
	let displayName = $state(record.displayName);
	/* svelte-ignore state_referenced_locally */
	let description = $state(record.description ?? '');
	/* svelte-ignore state_referenced_locally */
	let category = $state(record.category ?? '');
	/* svelte-ignore state_referenced_locally */
	let tags = $state<string[]>([...(record.tags ?? [])]);
	/* svelte-ignore state_referenced_locally */
	let projectId = $state(record.projectId);
	/* svelte-ignore state_referenced_locally */
	let computeServerId = $state<string | null>(record.computeServerId ?? null);
	/* svelte-ignore state_referenced_locally */
	let status = $state<DefinitionStatus>(record.status as DefinitionStatus);
	let userImageMode = $state<'url' | 'upload' | undefined>(undefined);
	/* svelte-ignore state_referenced_locally */
	let coverImageUrl = $state(record.coverImage ?? '');

	// File inputs
	let imageInput = $state<HTMLInputElement>();
	let imageHasFile = $state(false);

	// Dialog state
	let showDeleteConfirm = $state(false);
	let uploadingImage = $state(false);
	let pendingProjectId = $state<string | null>(null);

	const pendingProject = $derived(
		pendingProjectId ? (projects.find((p) => p.id === pendingProjectId) ?? null) : null
	);
	const currentProject = $derived(projects.find((p) => p.id === projectId) ?? null);

	function handleProjectChange(nextId: string) {
		if (nextId === projectId) return;
		pendingProjectId = nextId;
	}

	function confirmProjectChange() {
		if (pendingProjectId) projectId = pendingProjectId;
		pendingProjectId = null;
	}

	function cancelProjectChange() {
		pendingProjectId = null;
	}

	const imageMode = $derived<'url' | 'upload'>(
		userImageMode ?? (record.coverImage?.startsWith('/api/definitions/') ? 'upload' : 'url')
	);

	const statusItems: FilterableDropdownItem[] = [
		{ id: 'draft', label: 'Draft — work in progress' },
		{ id: 'published', label: 'Published — live and visible to runners' }
	];

	const computeServerItems = $derived<FilterableDropdownItem[]>(
		computeServers.map((s) => ({
			id: s.id,
			label: s.id === defaultComputeServerId ? `${s.label} (Default)` : s.label
		}))
	);

	async function handleImageUpload() {
		if (!imageInput?.files?.length) return;
		uploadingImage = true;
		const formData = new FormData();
		formData.append('image', imageInput.files[0]);
		try {
			const res = await fetch(`/api/definitions/${record.guid}/image`, {
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
			if (imageInput) imageInput.value = '';
			imageHasFile = false;
		}
	}

	function save() {
		onSave(record.guid, {
			displayName,
			description: description || undefined,
			category: category || undefined,
			tags: tags.length ? tags : undefined,
			coverImage: coverImageUrl || undefined,
			status,
			projectId: projectId || undefined,
			computeServerId
		});
	}
</script>

<Drawer {onClose} ariaLabel="Close edit drawer">
	<div class="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
		<div>
			<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">Editing</p>
			<h2 class="mt-0.5 text-base font-semibold">{record.displayName}</h2>
		</div>
		<Button variant="ghost" size="icon" onclick={onClose} class="h-8 w-8 shrink-0">
			<X class="h-4 w-4" />
		</Button>
	</div>

	{#if onBack}
		<button
			type="button"
			onclick={onBack}
			class="text-muted-foreground hover:text-foreground mx-6 mt-4 inline-flex items-center gap-1.5 self-start text-xs transition-colors"
		>
			<ArrowLeft class="h-3 w-3" />
			Back to definition
		</button>
	{/if}

	<Tabs.Root bind:value={activeTab} class="flex flex-1 flex-col overflow-hidden">
		<Tabs.List
			class={`mx-6 grid w-auto ${enableSharing ? 'grid-cols-3' : 'grid-cols-2'} ${onBack ? 'mt-2' : 'mt-4'}`}
		>
			<Tabs.Trigger value="details">Details</Tabs.Trigger>
			<Tabs.Trigger value="versions">Versions</Tabs.Trigger>
			{#if enableSharing}
				<Tabs.Trigger value="shares">Share links</Tabs.Trigger>
			{/if}
		</Tabs.List>

		<Tabs.Content value="versions" class="mt-4 flex-1 overflow-y-auto px-6 py-5">
			<VersionsSection definitionGuid={record.guid} {onOpenRunner} />
		</Tabs.Content>

		<Tabs.Content value="details" class="mt-4 flex-1 space-y-5 overflow-y-auto px-6 py-5">
			<div class="space-y-1.5">
				<Label for="edit-name">Display name</Label>
				<Input id="edit-name" bind:value={displayName} />
			</div>

			<div class="space-y-1.5">
				<Label for="edit-desc">Description</Label>
				<Textarea id="edit-desc" rows={3} bind:value={description} />
			</div>

			<div class="space-y-1.5">
				<Label for="edit-status">Status</Label>
				<FilterableDropdown
					id="edit-status"
					items={statusItems}
					value={status}
					onChange={(id) => (status = id as DefinitionStatus)}
				/>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1.5">
					<Label for="edit-cat">Category</Label>
					<Input id="edit-cat" maxlength={40} bind:value={category} placeholder="e.g. Facade" />
				</div>
				<div class="space-y-1.5">
					<div class="flex items-center justify-between">
						<Label for="edit-tags">Tags</Label>
						<span class="text-muted-foreground text-xs">{tags.length}/5</span>
					</div>
					{#if tags.length > 0}
						<div class="mb-1 flex flex-wrap gap-1">
							{#each tags as tag (tag)}
								<Badge variant="outline" class="gap-1 text-xs">
									{tag}
									<button
										onclick={() => (tags = tags.filter((t) => t !== tag))}
										class="hover:opacity-70"
										aria-label="Remove tag {tag}"
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
						disabled={tags.length >= 5}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								const el = e.currentTarget as HTMLInputElement;
								const tag = el.value.trim();
								if (tag && !tags.includes(tag) && tags.length < 5) {
									tags = [...tags, tag];
									el.value = '';
								}
							}
						}}
					/>
				</div>
			</div>

			<Separator />

			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<Image class="text-muted-foreground h-4 w-4" />
					<Label>Cover image</Label>
				</div>
				<ImageUploadField
					mode={imageMode}
					value={record.coverImage ?? ''}
					isUploading={uploadingImage}
					hasFile={imageHasFile}
					onModeChange={(m) => (userImageMode = m)}
					onUpload={handleImageUpload}
					onFileSelected={() => (imageHasFile = !!imageInput?.files?.length)}
					onUrlChange={(url) => (coverImageUrl = url)}
					bind:inputRef={imageInput}
				/>
			</div>

			{#if projects.length > 1 || computeServers.length > 0}
				<div class="grid grid-cols-2 gap-3">
					{#if projects.length > 1}
						<div class="space-y-1.5">
							<Label for="edit-proj">Project</Label>
							<ProjectPicker
								id="edit-proj"
								{projects}
								value={projectId}
								onChange={handleProjectChange}
							/>
						</div>
					{/if}
					{#if computeServers.length > 0}
						<div class="space-y-1.5">
							<Label for="edit-srv">Compute server</Label>
							<FilterableDropdown
								id="edit-srv"
								items={computeServerItems}
								value={computeServerId ?? defaultComputeServerId ?? ''}
								onChange={(picked) => {
									computeServerId = picked === defaultComputeServerId ? null : picked;
								}}
							/>
						</div>
					{/if}
				</div>
			{/if}
		</Tabs.Content>

		{#if enableSharing}
			<Tabs.Content value="shares" class="mt-4 flex-1 overflow-y-auto px-6 py-5">
				<ShareLinkSection definitionGuid={record.guid} />
			</Tabs.Content>
		{/if}
	</Tabs.Root>

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
			<Button variant="outline" size="sm" onclick={onClose}>Cancel</Button>
			{#if activeTab === 'details'}
				<Button size="sm" disabled={isSaving} onclick={save}>
					{isSaving ? 'Saving…' : 'Save'}
				</Button>
			{/if}
		</div>
	</div>
</Drawer>

<AlertDialog.Root open={showDeleteConfirm} onOpenChange={(o) => (showDeleteConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete "{record.displayName}"?</AlertDialog.Title>
			<AlertDialog.Description>
				This removes the definition and all its files. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={() => onDelete(record.guid)}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
	open={pendingProjectId !== null}
	onOpenChange={(o) => {
		if (!o) cancelProjectChange();
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Move to a different project?</AlertDialog.Title>
			<AlertDialog.Description>
				<strong>{record.displayName}</strong> will move from
				<strong>{currentProject?.name ?? '—'}</strong>
				to <strong>{pendingProject?.name ?? '—'}</strong>. Project members and visibility may change
				accordingly.{enableSharing ? ' Existing share links keep working.' : ''}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel onclick={cancelProjectChange}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmProjectChange}>Move</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
