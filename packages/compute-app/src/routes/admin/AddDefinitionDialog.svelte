<script lang="ts">
	import { Button, Dialog, Input, Label, Textarea, toast } from '@selva/shared';
	import ImageUploadField from './ImageUploadField.svelte';

	interface ValidatedSchema {
		name: string;
		description: string;
		inputCount: number;
		outputCount: number;
		tags: string[];
	}

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

	// Validation state
	let validating = $state(false);
	let validationError = $state<string | null>(null);
	let validationSchema = $state<ValidatedSchema | null>(null);

	function nameFromFile(file: File): string {
		return file.name
			.replace(/\.(gh|ghx)$/i, '')
			.replace(/[_-]/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	async function onFileSelected() {
		const file = fileInput?.files?.[0];
		hasFile = !!file;
		validationError = null;
		validationSchema = null;
		displayName = '';

		if (!file) return;

		displayName = nameFromFile(file);
		validating = true;

		try {
			const formData = new FormData();
			formData.append('files', file);
			const response = await fetch('/api/validate-solution', { method: 'POST', body: formData });

			// Endpoint unavailable — skip silently, name already set
			if (!response.ok) return;

			const results = await response.json();
			const result = results?.[0];
			if (!result) return;

			if (!result.valid) {
				// Compute server error — treat as unavailable, don't block
				if (result.error?.startsWith('Compute server error')) return;
				validationError = result.error ?? 'Validation failed';
				return;
			}

			// Valid — pre-fill from schema
			const schema: ValidatedSchema | null = result.schemas?.[0] ?? null;
			validationSchema = schema;
			if (schema?.name) displayName = schema.name;
			if (schema?.description) description = schema.description;
			if (schema?.tags?.length) tags = schema.tags.join(', ');
		} catch {
			// Network error — skip silently
		} finally {
			validating = false;
		}
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
		validating = false;
		validationError = null;
		validationSchema = null;
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

				<!-- Validation status -->
				{#if validating}
					<p class="text-muted-foreground flex items-center gap-2 text-xs">
						<svg class="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
						</svg>
						Validating definition…
					</p>
				{:else if validationError}
					<div class="border-warning/40 bg-warning/5 rounded-md border p-3">
						<p class="text-warning-foreground text-xs font-medium">Validation warning</p>
						<p class="text-warning-foreground/80 mt-0.5 text-xs">{validationError}</p>
						<p class="text-warning-foreground/60 mt-1 text-xs">You can still upload the file.</p>
					</div>
				{:else if validationSchema}
					<div class="flex items-center gap-3 rounded-md border border-success/30 bg-success/5 p-3">
						<div class="min-w-0 flex-1">
							<p class="text-xs font-medium text-success-foreground">Valid Selva definition</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								{validationSchema.inputCount} input{validationSchema.inputCount === 1 ? '' : 's'},
								{validationSchema.outputCount} output{validationSchema.outputCount === 1 ? '' : 's'}
							</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- Display Name -->
			<div class="space-y-2">
				<Label for="new-dn">Display Name <span class="text-destructive">*</span></Label>
				<Input id="new-dn" type="text" bind:value={displayName} placeholder="e.g., Parametric Tower" />
			</div>

			<!-- Description -->
			<div class="space-y-2">
				<Label for="new-desc">Description</Label>
				<Textarea id="new-desc" bind:value={description} rows={3} placeholder="Describe what this definition does…" />
			</div>

			<!-- Category & Tags -->
			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="new-cat">Category</Label>
					<Input id="new-cat" type="text" bind:value={category} placeholder="e.g., Architecture" />
				</div>
				<div class="space-y-2">
					<Label for="new-tags">Tags</Label>
					<Input id="new-tags" type="text" bind:value={tags} placeholder="parametric, tower" />
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
			<Button onclick={handleSubmit} disabled={isAdding || validating}>
				{isAdding ? 'Creating…' : validating ? 'Validating…' : 'Create Definition'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
