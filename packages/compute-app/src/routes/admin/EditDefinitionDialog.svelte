<script lang="ts">
	import {
		Button,
		Dialog,
		Input,
		Label,
		Separator,
		Textarea,
		toast,
		Badge,
		AlertDialog
	} from '@selva/shared';
	import { Trash2, History, Image, Upload, X } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';
	import FileUploadField from './FileUploadField.svelte';
	import ImageUploadField from './ImageUploadField.svelte';

	interface HistoryEntry {
		filename: string;
		originalName: string;
		date: string;
	}

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		file?: string;
		maxHistory?: number;
	}

	interface Props {
		open: boolean;
		guid: string;
		config: DefinitionConfig;
		history?: HistoryEntry[];
		savingDefinition?: boolean;
		uploadingDefinitionFile?: boolean;
		uploadingDefinitionImage?: boolean;
		revertingFile?: string | null;
		onOpenChange?: (open: boolean) => void;
		onSave?: (guid: string, config: DefinitionConfig) => void;
		onDelete?: (guid: string) => void;
		onFileUpload?: (guid: string) => void;
		onImageUpload?: (guid: string) => void;
		onRevert?: (guid: string, filename: string) => void;
	}

	let {
		open = false,
		guid,
		config = $bindable(),
		history = [],
		savingDefinition = false,
		uploadingDefinitionFile = false,
		uploadingDefinitionImage = false,
		revertingFile = null,
		onOpenChange,
		onSave
	}: Props = $props();

	let editImageMode = $state<'url' | 'upload'>('url');
	let imageJustUploaded = $state(false);
	let showFileUploadConfirm = $state(false);
	let showDeleteConfirm = $state(false);
	$effect(() => {
		editImageMode = config.coverImage?.startsWith('/api/definitions/') ? 'upload' : 'url';
	});
	let editModeImageInput = $state<HTMLInputElement>();
	let editModeFileInput = $state<HTMLInputElement>();
	let editModeFileHasFile = $state(false);
	let editModeImageHasFile = $state(false);

	function formatDate(iso: string): string {
		try {
			return new Date(iso).toLocaleString(undefined, {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	async function getErrorMessage(response: Response, fallback: string): Promise<string> {
		if (response.headers.get('content-type')?.includes('application/json')) {
			const err = await response.json().catch(() => null);
			return err?.message || err?.error?.message || `${fallback} (${response.status})`;
		}
		return `${fallback} (${response.status})`;
	}

	async function handleDelete() {
		showDeleteConfirm = true;
	}

	async function confirmDelete() {
		const name = config.displayName || guid;
		try {
			const response = await fetch(`/admin/api/definitions/${guid}`, { method: 'DELETE' });
			if (response.ok) {
				toast.success(`"${name}" deleted`);
				onOpenChange?.(false);
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Delete failed'));
			}
		} catch (err) {
			toast.error('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			showDeleteConfirm = false;
		}
	}

	async function handleFileUpload() {
		if (!editModeFileInput?.files || editModeFileInput.files.length === 0) {
			toast.error('Please select a file first');
			return;
		}
		showFileUploadConfirm = true;
	}

	async function confirmFileUpload() {
		if (!editModeFileInput?.files || editModeFileInput.files.length === 0) {
			return;
		}
		const formData = new FormData();
		formData.append('file', editModeFileInput.files[0]);
		formData.append('guid', guid);
		try {
			const response = await fetch('/admin/api/definitions/upload', {
				method: 'POST',
				body: formData
			});
			if (response.ok) {
				const result = await response.json();
				toast.success(`"${result.filename}" uploaded – old version archived`);
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Upload failed'));
			}
		} catch (err) {
			toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			if (editModeFileInput) editModeFileInput.value = '';
			showFileUploadConfirm = false;
		}
	}

	async function handleImageUpload() {
		if (!editModeImageInput?.files?.length) {
			toast.error('Please select an image first');
			return;
		}
		const formData = new FormData();
		formData.append('image', editModeImageInput.files[0]);
		try {
			const response = await fetch(`/admin/api/definitions/${guid}/image`, {
				method: 'POST',
				body: formData
			});
			if (response.ok) {
				const result = await response.json();
				config.coverImage = result.coverImage;
				imageJustUploaded = true;
				toast.success('Image uploaded');
				await invalidateAll();
				// Hide message after 5 seconds
				setTimeout(() => {
					imageJustUploaded = false;
				}, 5000);
			} else {
				toast.error(await getErrorMessage(response, 'Image upload failed'));
			}
		} catch (err) {
			toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			if (editModeImageInput) editModeImageInput.value = '';
		}
	}

	async function handleRevert(filename: string) {
		try {
			const response = await fetch(`/admin/api/definitions/${guid}/revert`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ filename })
			});
			if (response.ok) {
				const result = await response.json();
				toast.success(`Reverted to "${result.filename}"`);
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Revert failed'));
			}
		} catch (err) {
			toast.error('Revert failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		}
	}
</script>

<Dialog.Root {open} onOpenChange={(o) => onOpenChange?.(o)}>
	<Dialog.Content class="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg flex-col p-0">
		<Dialog.Header class="px-4 py-3 sm:px-6 sm:py-4">
			<Dialog.Title>Edit — {config.displayName || guid}</Dialog.Title>
			<Dialog.Description class="font-mono text-xs">{guid}</Dialog.Description>
		</Dialog.Header>

		<div class="flex-1 overflow-y-auto px-4 py-3 sm:px-6">
			<div class="space-y-5">
				<!-- Display Name -->
				<div class="space-y-1">
					<Label for="dn-{guid}">Display Name</Label>
					<Input id="dn-{guid}" type="text" bind:value={config.displayName} />
				</div>

				<!-- Description -->
				<div class="space-y-1">
					<Label for="desc-{guid}">Description</Label>
					<Textarea id="desc-{guid}" rows={2} bind:value={config.description} />
				</div>

				<!-- Category & Tags -->
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					<div class="space-y-1">
						<div class="flex items-center justify-between">
							<Label for="cat-{guid}">Category</Label>
							<p class="text-muted-foreground text-xs">{config.category?.length ?? 0}/40</p>
						</div>
						<Input id="cat-{guid}" type="text" maxlength={40} bind:value={config.category} />
					</div>
					<div class="space-y-1">
						<div class="flex items-center justify-between">
							<Label for="tags-{guid}">Tags</Label>
							<p class="text-muted-foreground text-xs">{config.tags?.length ?? 0}/5</p>
						</div>
						{#if config.tags && config.tags.length > 0}
							<div class="mb-2 flex flex-wrap gap-2">
								{#each config.tags as tag (tag)}
									<Badge variant="outline" class="cursor-pointer gap-1">
										{tag}
										<button
											type="button"
											class="ml-0.5 inline-flex items-center justify-center transition-opacity hover:opacity-70"
											onclick={() => {
												config.tags = config.tags?.filter((t) => t !== tag) ?? [];
											}}
											title="Remove tag"
										>
											<X class="h-3 w-3" />
										</button>
									</Badge>
								{/each}
							</div>
						{/if}
						<Input
							id="tags-{guid}"
							type="text"
							placeholder="Add tag and press Enter"
							disabled={config.tags && config.tags.length >= 5}
							onkeydown={(e) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									const input = e.currentTarget as HTMLInputElement;
									const tag = input.value.trim();
									if (
										tag &&
										!config.tags?.includes(tag) &&
										(!config.tags || config.tags.length < 5)
									) {
										config.tags = [...(config.tags ?? []), tag];
										input.value = '';
									}
								}
							}}
						/>
					</div>
				</div>

				<Separator />

				<!-- Cover Image -->
				<div class="border-ring/60 bg-ring/20 space-y-2 rounded-lg border p-4">
					<div class="flex items-center gap-2">
						<Image class="text-ring h-4 w-4" />
						<Label class="font-semibold">Cover Image</Label>
					</div>
					<div class="min-w-0 space-y-2">
						<div class="overflow-x-auto">
							<ImageUploadField
								mode={editImageMode}
								value=""
								isUploading={uploadingDefinitionImage}
								hasFile={editModeImageHasFile}
								onModeChange={(m) => (editImageMode = m)}
								onUpload={handleImageUpload}
								onFileSelected={() => (editModeImageHasFile = !!editModeImageInput?.files?.length)}
								onUrlChange={(url) => (config.coverImage = url)}
								bind:inputRef={editModeImageInput}
							/>
						</div>
						{#if imageJustUploaded}
							<p class="text-xs font-medium text-success">✓ Image saved in definition folder</p>
						{/if}
					</div>
				</div>

				<!-- Grasshopper File -->
				<div
					class="border-muted-foreground/40 bg-muted/40 hidden space-y-2 rounded-lg border p-4 md:block"
				>
					<div class="flex items-center gap-2">
						<Upload class="text-muted-foreground h-4 w-4" />
						<Label class="font-semibold">Grasshopper File</Label>
					</div>
					<div class="min-w-0 space-y-2">
						{#if config.file}
							<p class="text-muted-foreground text-xs">
								Current: <code class="font-mono">{config.file}</code>
							</p>
						{/if}
						<p class="text-muted-foreground text-xs">
							Upload to replace — old file archived with timestamp prefix.
						</p>
						<div class="overflow-x-auto">
							<FileUploadField
								id="edit-gh-file-{guid}"
								label="Grasshopper File"
								accept=".gh,.ghx"
								isUploading={uploadingDefinitionFile}
								hasFile={editModeFileHasFile}
								onFileSelected={() => (editModeFileHasFile = !!editModeFileInput?.files?.length)}
								onUpload={handleFileUpload}
								bind:inputRef={editModeFileInput}
							/>
						</div>
					</div>
				</div>

				<!-- Version history limit -->
				<div class="space-y-1">
					<Label for="maxHistory-{guid}">Version history limit</Label>
					<Input
						id="maxHistory-{guid}"
						type="number"
						min="0"
						step="1"
						placeholder="0 (keep all)"
						value={config.maxHistory ?? ''}
						oninput={(e) => {
							const val = parseInt((e.currentTarget as HTMLInputElement).value, 10);
							config.maxHistory = isNaN(val) || val < 0 ? undefined : val;
						}}
					/>
					<p class="text-muted-foreground text-xs">0 or empty = keep all archived versions</p>
				</div>

				<!-- File History -->
				{#if history.length > 0}
					<div class="space-y-2">
						<p class="text-muted-foreground flex items-center gap-1 text-xs font-medium">
							<History class="h-3 w-3" /> Archived versions ({history.length})
						</p>
						<ul class="space-y-1.5">
							{#each history as entry (entry.filename)}
								<li class="flex items-center gap-2">
									<div class="min-w-0 flex-1">
										<p class="truncate font-mono text-xs">{entry.originalName}</p>
										<p class="text-muted-foreground text-xs">{formatDate(entry.date)}</p>
									</div>
									<Button
										size="sm"
										variant="outline"
										class="h-6 shrink-0 px-2 text-xs"
										disabled={revertingFile === entry.filename}
										onclick={() => handleRevert(entry.filename)}
									>
										{revertingFile === entry.filename ? 'Reverting…' : 'Revert'}
									</Button>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="gap-2 border-t px-4 py-3 sm:px-6">
			<Button variant="destructive" onclick={handleDelete} class="mr-auto">
				<Trash2 class="mr-2 h-4 w-4" /> Delete
			</Button>
			<Button variant="outline" onclick={() => onOpenChange?.(false)}>Cancel</Button>
			<Button onclick={() => onSave?.(guid, config)} disabled={savingDefinition}>
				{savingDefinition ? 'Saving…' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={showFileUploadConfirm} onOpenChange={(o) => (showFileUploadConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Replace Grasshopper File?</AlertDialog.Title>
			<AlertDialog.Description>
				This will replace the current Grasshopper file with the selected one. The old file will be
				archived with a timestamp prefix.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmFileUpload} disabled={uploadingDefinitionFile}>
				{uploadingDefinitionFile ? 'Uploading…' : 'Replace'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root open={showDeleteConfirm} onOpenChange={(o) => (showDeleteConfirm = o)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete Definition?</AlertDialog.Title>
			<AlertDialog.Description>
				This will delete "{config.displayName || guid}" and all its files. This action cannot be
				undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={confirmDelete}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
