<script lang="ts">
	import { Button, Dialog, Input, Label, Textarea, toast } from '@selva/shared';
	import ImageUploadField from './ImageUploadField.svelte';

	interface Props {
		open: boolean;
		isAdding?: boolean;
		onOpenChange?: (open: boolean) => void;
		onSubmit?: (data: FormData) => Promise<void>;
	}

	let { open = false, isAdding = false, onOpenChange, onSubmit }: Props = $props();

	// Form state
	let displayName = $state('');
	let description = $state('');
	let category = $state('');
	let tags = $state('');
	let coverImage = $state('');
	let imageMode = $state<'url' | 'upload'>('url');

	// File inputs
	let fileInput = $state<HTMLInputElement>();
	let imageInput = $state<HTMLInputElement>();
	let hasFile = $state(false);

	function nameFromFile(file: File): string {
		return file.name
			.replace(/\.(gh|ghx)$/i, '')
			.replace(/[_-]/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	function onFileSelected() {
		const file = fileInput?.files?.[0];
		hasFile = !!file;
		if (!file) return;
		displayName = nameFromFile(file);
	}

	async function handleSubmit() {
		if (!displayName.trim()) {
			toast.error('Display name is required');
			return;
		}
		if (!fileInput?.files || fileInput.files.length === 0) {
			toast.error('A Grasshopper file is required');
			return;
		}

		const formData = new FormData();
		formData.append('displayName', displayName.trim());
		formData.append('description', description);
		formData.append('category', category);
		formData.append('tags', tags);

		if (imageMode === 'upload' && imageInput?.files?.[0]) {
			formData.append('image', imageInput.files[0]);
		} else if (imageMode === 'url' && coverImage.trim()) {
			formData.append('coverImage', coverImage.trim());
		}

		formData.append('file', fileInput.files[0]);

		try {
			await onSubmit?.(formData);
			// onSubmit closes the dialog on success; if it throws, stay open
		} catch {
			// error already toasted by onSubmit
		}
	}

	function resetForm() {
		displayName = '';
		description = '';
		category = '';
		tags = '';
		coverImage = '';
		imageMode = 'url';
		hasFile = false;
		if (fileInput) fileInput.value = '';
		if (imageInput) imageInput.value = '';
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen) resetForm();
		onOpenChange?.(newOpen);
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Add New Definition</Dialog.Title>
			<Dialog.Description>Upload a Grasshopper file and fill in the metadata.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- File Upload -->
			<div class="space-y-2">
				<Label for="new-file">
					Grasshopper File <span class="text-destructive">*</span>
				</Label>
				<input
					id="new-file"
					type="file"
					accept=".gh,.ghx"
					bind:this={fileInput}
					onchange={onFileSelected}
					class="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
				/>
			</div>

			<!-- Display Name -->
			<div class="space-y-2">
				<Label for="new-dn">Display Name <span class="text-destructive">*</span></Label>
				<Input
					id="new-dn"
					type="text"
					bind:value={displayName}
					placeholder="e.g., Parametric Tower"
				/>
			</div>

			<!-- Description -->
			<div class="space-y-2">
				<Label for="new-desc">Description</Label>
				<Textarea
					id="new-desc"
					bind:value={description}
					rows={3}
					placeholder="Describe what this definition does…"
				/>
			</div>

			<!-- Category & Tags -->
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="new-cat">Category</Label>
					<Input
						id="new-cat"
						type="text"
						bind:value={category}
						placeholder="e.g., Architecture"
					/>
				</div>
				<div class="space-y-2">
					<Label for="new-tags">Tags</Label>
					<Input
						id="new-tags"
						type="text"
						bind:value={tags}
						placeholder="parametric, tower"
					/>
				</div>
			</div>

			<!-- Cover Image -->
			<div class="space-y-2">
				<Label>Cover Image</Label>
				<ImageUploadField
					mode={imageMode}
					value={coverImage}
					onModeChange={(m) => (imageMode = m)}
					onUpload={() => {}}
					onFileSelected={() => {}}
					onUrlChange={(url) => (coverImage = url)}
					bind:inputRef={imageInput}
				/>
			</div>
		</div>

		<Dialog.Footer class="gap-2 sm:justify-end">
			<Button variant="outline" onclick={() => onOpenChange?.(false)}>Cancel</Button>
			<Button onclick={handleSubmit} disabled={isAdding}>
				{isAdding ? 'Creating…' : 'Create Definition'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
