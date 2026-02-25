<script lang="ts">
	import { Button, Dialog, Input, Label, Separator, Textarea, toast } from '@selva/shared';
	import { Trash2, History } from '@lucide/svelte';
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
		config,
		history = [],
		savingDefinition = false,
		uploadingDefinitionFile = false,
		uploadingDefinitionImage = false,
		revertingFile = null,
		onOpenChange,
		onSave
	}: Props = $props();

	let editImageMode = $state<'url' | 'upload'>(
		config.coverImage?.startsWith('/admin/') ? 'upload' : 'url'
	);
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
		const name = config.displayName || guid;
		if (!confirm(`Delete "${name}" and all its files? This cannot be undone.`)) return;
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
		}
	}

	async function handleFileUpload() {
		if (!editModeFileInput?.files || editModeFileInput.files.length === 0) {
			toast.error('Please select a file first');
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
				toast.success('Image uploaded');
				await invalidateAll();
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
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Edit — {config.displayName || guid}</Dialog.Title>
			<Dialog.Description class="font-mono text-xs">{guid}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-3">
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
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1">
					<Label for="cat-{guid}">Category</Label>
					<Input id="cat-{guid}" type="text" bind:value={config.category} />
				</div>
				<div class="space-y-1">
					<Label for="tags-{guid}">Tags</Label>
					<Input
						id="tags-{guid}"
						type="text"
						value={config.tags?.join(', ') || ''}
						oninput={(e) => {
							const t = e.currentTarget as HTMLInputElement;
							config.tags = [
								...new Set(
									t.value
										.split(',')
										.map((s) => s.trim())
										.filter(Boolean)
								)
							];
						}}
						placeholder="comma, separated"
					/>
				</div>
			</div>

			<Separator />

			<!-- Cover Image -->
			<div class="space-y-1">
				<Label>Cover Image</Label>
				<ImageUploadField
					mode={editImageMode}
					value=""
					isUploading={uploadingDefinitionImage}
					hasFile={editModeImageHasFile}
					onModeChange={(m) => (editImageMode = m)}
					onUpload={handleImageUpload}
					onFileSelected={() => (editModeImageHasFile = !!editModeImageInput?.files?.length)}
					onUrlChange={(url) => (config.coverImage = url)}
					inputRef={editModeImageInput}
				/>
				{#if config.coverImage?.startsWith('/admin/api/definitions/')}
					<p class="text-muted-foreground text-xs">✓ Image saved in definition folder</p>
				{/if}
			</div>

			<Separator />

			<!-- Grasshopper File -->
			<div class="space-y-1">
				<Label>Grasshopper File</Label>
				{#if config.file}
					<p class="text-muted-foreground text-xs">
						Current: <code class="font-mono">{config.file}</code>
					</p>
				{/if}
				<p class="text-muted-foreground text-xs">
					Upload to replace — old file archived with timestamp prefix.
				</p>
				<FileUploadField
					id="edit-gh-file-{guid}"
					label="Grasshopper File"
					accept=".gh,.ghx"
					isUploading={uploadingDefinitionFile}
					hasFile={editModeFileHasFile}
					onFileSelected={() => (editModeFileHasFile = !!editModeFileInput?.files?.length)}
					onUpload={handleFileUpload}
					inputRef={editModeFileInput}
				/>
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
				<div class="space-y-1">
					<p class="text-muted-foreground flex items-center gap-1 text-xs font-medium">
						<History class="h-3 w-3" /> Archived versions ({history.length})
					</p>
					<ul class="space-y-1.5">
						{#each history as entry}
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

		<Dialog.Footer class="gap-2">
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
