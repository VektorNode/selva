<script lang="ts">
	import { Button, Dialog, Input, Label, Textarea, toast, Badge } from '@selvajs/shared';
	import { X } from '@lucide/svelte';
	import ImageUploadField from './ImageUploadField.svelte';
	import ProjectPicker from './ProjectPicker.svelte';

	interface Project {
		id: string;
		name: string;
	}

	interface ComputeServer {
		id: string;
		label: string;
		serverUrl: string;
	}

	interface Props {
		open: boolean;
		isAdding?: boolean;
		projects?: Project[];
		defaultProjectId?: string;
		computeServers?: ComputeServer[];
		showProjectDropdown?: boolean;
		onOpenChange?: (open: boolean) => void;
		onSubmit?: (data: FormData) => Promise<void>;
	}

	let {
		open = false,
		isAdding = false,
		projects = [],
		defaultProjectId,
		computeServers = [],
		showProjectDropdown = false,
		onOpenChange,
		onSubmit
	}: Props = $props();

	// Form state
	let displayName = $state('');
	let description = $state('');
	let category = $state('');
	let tags = $state<string[]>([]);
	let coverImage = $state('');
	let imageMode = $state<'url' | 'upload'>('url');
	let selectedProjectId = $state('');
	let selectedComputeServerId = $state('');

	$effect(() => {
		if (defaultProjectId) selectedProjectId = defaultProjectId;
	});

	// File inputs
	let fileInput = $state<HTMLInputElement>();
	let imageInput = $state<HTMLInputElement>();

	// Validation state
	let validating = $state(false);
	let validationError = $state<string | null>(null);
	let validationSchema = $state<{
		name: string;
		description?: string;
		tags?: string[];
		inputs: unknown[];
		outputs: unknown[];
	} | null>(null);

	function nameFromFile(file: File): string {
		return file.name
			.replace(/\.(gh|ghx)$/i, '')
			.replace(/[_-]/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	async function onFileSelected() {
		const file = fileInput?.files?.[0];
		validationError = null;
		validationSchema = null;
		displayName = '';

		if (!file) return;

		displayName = nameFromFile(file);

		// Schema preview needs a target project for the upload-rights gate. If one
		// isn't picked yet, skip the preview — the user still gets the filename-derived
		// name and can submit; server-side validation runs on actual upload.
		if (!selectedProjectId) return;

		validating = true;

		try {
			const formData = new FormData();
			formData.append('files', file);
			const response = await fetch(
				`/api/compute/schema?projectId=${encodeURIComponent(selectedProjectId)}`,
				{ method: 'POST', body: formData }
			);

			// Compute unreachable — skip silently, name already set from filename
			if (response.status === 404) return;

			const body = await response.json();

			if (!response.ok) {
				validationError = body?.message ?? 'Validation failed';
				return;
			}

			const schema = body?.[0];
			if (!schema) return;

			// Pre-fill from UISchema
			validationSchema = schema;
			if (schema.name) displayName = schema.name;
			if (schema.description) description = schema.description;
			if (schema.tags?.length) tags = schema.tags;
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
		formData.append('tags', tags.join(','));

		if (imageMode === 'upload' && imageInput?.files?.[0]) {
			formData.append('image', imageInput.files[0]);
		} else if (imageMode === 'url' && coverImage.trim()) {
			formData.append('coverImage', coverImage.trim());
		}

		formData.append('file', fileInput.files[0]);
		if (selectedProjectId) formData.append('projectId', selectedProjectId);
		if (selectedComputeServerId) formData.append('computeServerId', selectedComputeServerId);

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
		tags = [];
		coverImage = '';
		imageMode = 'url';
		selectedProjectId = defaultProjectId ?? '';
		selectedComputeServerId = '';
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
			<!-- Project & compute server -->
			{#if showProjectDropdown || computeServers.length > 1}
				<div
					class="grid gap-3 {showProjectDropdown && computeServers.length > 1
						? 'sm:grid-cols-2'
						: ''}"
				>
					{#if showProjectDropdown}
						<div class="space-y-1">
							<Label for="new-project">Project</Label>
							<ProjectPicker
								id="new-project"
								{projects}
								value={selectedProjectId}
								onChange={(id) => (selectedProjectId = id)}
							/>
						</div>
					{:else if defaultProjectId}
						{@const selectedProject = projects.find((p) => p.id === defaultProjectId)}
						<div class="space-y-1">
							<Label>Project</Label>
							<div class="bg-muted rounded-md px-3 py-2">
								<p class="text-sm font-medium">{selectedProject?.name ?? 'Unknown'}</p>
							</div>
						</div>
					{/if}
					{#if computeServers.length > 1}
						<div class="space-y-1">
							<Label for="new-server">Compute Server</Label>
							<select
								id="new-server"
								bind:value={selectedComputeServerId}
								class="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
							>
								<option value="">Default</option>
								{#each computeServers as s (s.id)}
									<option value={s.id}>{s.label}</option>
								{/each}
							</select>
						</div>
					{/if}
				</div>
			{/if}

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
							<circle
								class="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								stroke-width="4"
							/>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
						</svg>
						Validating definition…
					</p>
				{:else if validationError}
					<div class="border-warning/40 bg-warning/5 rounded-md border p-3">
						<p class="text-warning text-xs font-medium">Validation warning</p>
						<p class="text-warning/80 mt-0.5 text-xs">{validationError}</p>
						<p class="text-warning/60 mt-1 text-xs">You can still upload the file.</p>
					</div>
				{:else if validationSchema}
					<div class="border-success/30 bg-success/5 flex items-center gap-3 rounded-md border p-3">
						<div class="min-w-0 flex-1">
							<p class="text-success text-xs font-medium">Valid Selva definition</p>
							<p class="text-muted-foreground mt-0.5 text-xs">
								{validationSchema.inputs.length} input{validationSchema.inputs.length === 1
									? ''
									: 's'},
								{validationSchema.outputs.length} output{validationSchema.outputs.length === 1
									? ''
									: 's'}
							</p>
						</div>
					</div>
				{/if}
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
			<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<Label for="new-cat">Category</Label>
						<p class="text-muted-foreground text-xs">{category?.length ?? 0}/40</p>
					</div>
					<Input
						id="new-cat"
						type="text"
						maxlength={40}
						bind:value={category}
						placeholder="e.g., Architecture"
					/>
				</div>
				<div class="space-y-1">
					<div class="flex items-center justify-between">
						<Label for="new-tags">Tags</Label>
						<p class="text-muted-foreground text-xs">{tags.length}/5</p>
					</div>
					{#if tags.length > 0}
						<div class="mb-2 flex flex-wrap gap-2">
							{#each tags as tag (tag)}
								<Badge variant="outline" class="cursor-pointer gap-1">
									{tag}
									<button
										type="button"
										class="ml-0.5 inline-flex items-center justify-center transition-opacity hover:opacity-70"
										onclick={() => {
											tags = tags.filter((t) => t !== tag);
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
						id="new-tags"
						type="text"
						placeholder="Add tag and press Enter"
						disabled={tags.length >= 5}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								const input = e.currentTarget as HTMLInputElement;
								const tag = input.value.trim();
								if (tag && !tags.includes(tag) && tags.length < 5) {
									tags = [...tags, tag];
									input.value = '';
								}
							}
						}}
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
			<Button onclick={handleSubmit} disabled={isAdding || validating}>
				{isAdding ? 'Creating…' : validating ? 'Validating…' : 'Create Definition'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
