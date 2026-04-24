<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import {
		AlertDialog,
		Badge,
		Button,
		Drawer,
		Input,
		Label,
		Separator,
		Textarea,
		toast
	} from 'selva-shared';
	import { History, Image, RotateCcw, Trash2, Upload, X } from '@lucide/svelte';
	import ImageUploadField from '$lib/components/definitions/ImageUploadField.svelte';
	import FileUploadField from '$lib/components/definitions/FileUploadField.svelte';
	import type {
		DefinitionRecord,
		ProjectWithMembers,
		ComputeServerConfig
	} from '../+page.server';
	import type { DefinitionStatus } from '@selva/platform';

	export interface EditPatch {
		displayName: string;
		description?: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		status: DefinitionStatus;
		projectId?: string;
		computeServerId: string | null;
		maxHistory?: number;
	}

	interface Props {
		record: DefinitionRecord;
		projects: ProjectWithMembers[];
		computeServers: ComputeServerConfig[];
		isSaving: boolean;
		onClose: () => void;
		onSave: (guid: string, patch: EditPatch) => Promise<void>;
		onDelete: (guid: string) => Promise<void>;
	}

	let { record, projects, computeServers, isSaving, onClose, onSave, onDelete }: Props = $props();

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
	/* svelte-ignore state_referenced_locally */
	let maxHistory = $state<number | undefined>(
		record.maxHistory > 0 ? record.maxHistory : undefined
	);
	let userImageMode = $state<'url' | 'upload' | undefined>(undefined);
	/* svelte-ignore state_referenced_locally */
	let coverImageUrl = $state(record.coverImage ?? '');

	// File inputs
	let imageInput = $state<HTMLInputElement>();
	let imageHasFile = $state(false);
	let fileInput = $state<HTMLInputElement>();
	let fileHasFile = $state(false);

	// Dialog state
	let showDeleteConfirm = $state(false);
	let showFileUploadConfirm = $state(false);
	let uploadingFile = $state(false);
	let uploadingImage = $state(false);
	let revertingRef = $state<string | null>(null);
	let revertTarget = $state<{ ref: string; originalName: string } | null>(null);

	const imageMode = $derived<'url' | 'upload'>(
		userImageMode ?? (record.coverImage?.startsWith('/api/definitions/') ? 'upload' : 'url')
	);

	async function confirmFileUpload() {
		if (!fileInput?.files?.length) return;
		uploadingFile = true;
		const formData = new FormData();
		formData.append('file', fileInput.files[0]);
		formData.append('guid', record.guid);
		try {
			const res = await fetch('/api/definitions/upload', {
				method: 'POST',
				body: formData
			});
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
			if (fileInput) fileInput.value = '';
			fileHasFile = false;
		}
	}

	async function confirmRevert() {
		if (!revertTarget) return;
		const target = revertTarget;
		revertingRef = target.ref;
		try {
			const res = await fetch(`/api/definitions/${record.guid}/revert`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ref: target.ref })
			});
			if (res.ok) {
				toast.success(`Restored "${target.originalName}"`);
				await invalidateAll();
			} else {
				const e = await res.json().catch(() => ({}));
				toast.error(e.message || 'Restore failed');
			}
		} catch {
			toast.error('Restore failed');
		} finally {
			revertingRef = null;
			revertTarget = null;
		}
	}

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
			computeServerId,
			maxHistory
		});
	}
</script>

<Drawer {onClose} ariaLabel="Close edit drawer">
	<div class="border-border flex shrink-0 items-center justify-between border-b px-6 py-4">
		<div>
			<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
				Editing
			</p>
			<h2 class="mt-0.5 text-base font-semibold">{record.displayName}</h2>
		</div>
		<Button variant="ghost" size="icon" onclick={onClose} class="h-8 w-8 shrink-0">
			<X class="h-4 w-4" />
		</Button>
	</div>

	<div class="flex-1 space-y-5 overflow-y-auto px-6 py-5">
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
			<select
				id="edit-status"
				bind:value={status}
				class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
			>
				<option value="draft">Draft — work in progress</option>
				<option value="review">Review — submitted for review</option>
				<option value="published">Published — live and visible to runners</option>
				<option value="archived">Archived — retired, hidden from runners</option>
			</select>
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

		<div class="space-y-2">
			<div class="flex items-center gap-2">
				<Upload class="text-muted-foreground h-4 w-4" />
				<Label>Grasshopper file</Label>
			</div>
			{#if record.originalFilename}
				<p class="text-muted-foreground font-mono text-xs">
					Current: {record.originalFilename}
				</p>
			{/if}
			<FileUploadField
				id="edit-gh-{record.guid}"
				accept=".gh,.ghx"
				isUploading={uploadingFile}
				hasFile={fileHasFile}
				onFileSelected={() => (fileHasFile = !!fileInput?.files?.length)}
				onUpload={() => (showFileUploadConfirm = true)}
				bind:inputRef={fileInput}
			/>
		</div>

		{#if record.history && record.history.length > 0}
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<History class="text-muted-foreground h-4 w-4" />
					<Label>Version history</Label>
					<span class="text-muted-foreground text-xs">({record.history.length})</span>
				</div>
				<div class="border-border divide-border divide-y rounded-md border">
					{#each record.history as entry (entry.ref)}
						<div class="flex items-center justify-between gap-2 px-3 py-2">
							<div class="min-w-0 flex-1">
								<p class="truncate font-mono text-xs">{entry.originalName}</p>
								<p class="text-muted-foreground text-[10.5px]">
									Archived {new Date(entry.archivedAt).toLocaleString()}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
								disabled={revertingRef !== null}
								onclick={() =>
									(revertTarget = { ref: entry.ref, originalName: entry.originalName })}
								class="h-7 gap-1 px-2 text-xs"
							>
								<RotateCcw class="h-3 w-3" />
								{revertingRef === entry.ref ? 'Restoring…' : 'Restore'}
							</Button>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if projects.length > 1 || computeServers.length > 1}
			<div class="grid grid-cols-2 gap-3">
				{#if projects.length > 1}
					<div class="space-y-1.5">
						<Label for="edit-proj">Project</Label>
						<select
							id="edit-proj"
							bind:value={projectId}
							class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
						>
							{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
						</select>
					</div>
				{/if}
				{#if computeServers.length > 1}
					<div class="space-y-1.5">
						<Label for="edit-srv">Compute server</Label>
						<select
							id="edit-srv"
							value={computeServerId ?? ''}
							onchange={(e) => {
								computeServerId = (e.currentTarget as HTMLSelectElement).value || null;
							}}
							class="border-input bg-background h-10 w-full rounded-md border px-3 text-sm"
						>
							<option value="">Default</option>
							{#each computeServers as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
						</select>
					</div>
				{/if}
			</div>
		{/if}
	</div>

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
			<Button size="sm" disabled={isSaving} onclick={save}>
				{isSaving ? 'Saving…' : 'Save'}
			</Button>
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
	open={revertTarget !== null}
	onOpenChange={(o: boolean) => {
		if (!o) revertTarget = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Restore "{revertTarget?.originalName}"?</AlertDialog.Title>
			<AlertDialog.Description>
				The current file will be archived and this version will become active.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmRevert} disabled={revertingRef !== null}>
				{revertingRef !== null ? 'Restoring…' : 'Restore'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={showFileUploadConfirm} onOpenChange={(o) => (showFileUploadConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Replace Grasshopper file?</AlertDialog.Title>
			<AlertDialog.Description>
				The current file will be archived. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmFileUpload} disabled={uploadingFile}>
				{uploadingFile ? 'Uploading…' : 'Replace'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
