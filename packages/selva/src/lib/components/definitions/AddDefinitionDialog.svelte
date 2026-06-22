<script lang="ts">
	import {
		Badge,
		Button,
		Dialog,
		ImageUploadField,
		Input,
		Label,
		Textarea,
		toast
	} from '@selvajs/ui';
	import { X } from '@lucide/svelte';
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
		defaultComputeServerId?: string | null;
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
		defaultComputeServerId = null,
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

	// Re-run validation when the file, project, or compute server selection changes:
	// a project unblocks the first validation; changing the server must re-extract
	// the schema on that server (it may differ, e.g. block-instance support).
	// lastValidatedKey dedupes so the effect doesn't loop on the validating/schema
	// writes onFileSelected makes.
	let lastValidatedKey = $state<string | null>(null);
	$effect(() => {
		if (!selectedProjectId || !selectedFile) return;
		const key = [
			selectedProjectId,
			selectedComputeServerId,
			selectedFile.name,
			selectedFile.size,
			selectedFile.lastModified
		].join('|');
		if (key === lastValidatedKey || validating) return;
		lastValidatedKey = key;
		onFileSelected();
	});

	// File inputs
	let fileInput = $state<HTMLInputElement>();
	// Reactive mirror of the chosen .gh file so the validation effect can key off
	// it (the bare input element isn't reactive). Set by the file input onchange.
	let selectedFile = $state<File | null>(null);
	let imageInput = $state<HTMLInputElement>();
	let imageHasFile = $state(false);

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

	function formatBytes(bytes: number): string {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function nameFromFile(file: File): string {
		return file.name
			.replace(/\.(gh|ghx)$/i, '')
			.replace(/[_-]/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	// Mirror the chosen file into reactive state and reset any fields pre-filled
	// from a previous file's schema. The validation effect picks up the new file
	// (and re-runs if project/server change). Submission stays blocked until a
	// project is picked and validation succeeds.
	function onFileChanged() {
		const file = fileInput?.files?.[0] ?? null;
		validationError = null;
		validationSchema = null;
		description = '';
		tags = [];
		selectedFile = file;
		displayName = file ? nameFromFile(file) : '';
	}

	// Extract + validate the schema for the current file on the selected server.
	// Guarded by the effect: selectedProjectId and selectedFile are non-null here.
	async function onFileSelected() {
		const file = selectedFile;
		if (!file || !selectedProjectId) return;

		validating = true;

		try {
			const formData = new FormData();
			formData.append('files', file);
			// Extract the schema on the same server the upload will use, so the
			// preview matches what later solves the definition. Mirrors the
			// computeServerId sent on submit.
			const params = new URLSearchParams(
				selectedComputeServerId
					? { projectId: selectedProjectId, computeServerId: selectedComputeServerId }
					: { projectId: selectedProjectId }
			).toString();
			const response = await fetch(`/api/compute/schema?${params}`, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				// Schema extraction is a hard gate: the server rejects uploads that
				// don't validate, so surface the failure and block submission here.
				const body = await response.json().catch(() => null);
				// A 413 can come from the app's size guard OR from an upstream proxy /
				// adapter-node BODY_SIZE_LIMIT — the latter returns a non-JSON body, so
				// don't rely on body.message being present. Either way the cause is the
				// same: the .gh is too large for the configured upload limit.
				if (response.status === 413) {
					validationError =
						body?.message ??
						`This Grasshopper file is too large to upload (${formatBytes(file.size)}). Reduce its size or raise the server's upload limit.`;
					return;
				}
				validationError =
					body?.message ??
					(response.status === 503
						? 'Compute server is unreachable. It must be online to upload a definition.'
						: 'Validation failed');
				return;
			}

			const body = await response.json();
			const schema = body?.[0];
			if (!schema) {
				validationError = 'No valid Selva schema found in this definition.';
				return;
			}

			// Pre-fill from UISchema
			validationSchema = schema;
			if (schema.name) displayName = schema.name;
			if (schema.description) description = schema.description;
			if (schema.tags?.length) tags = schema.tags;
		} catch {
			validationError = 'Compute server is unreachable. It must be online to upload a definition.';
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
		if (showProjectDropdown && !selectedProjectId) {
			toast.error('Please pick a project');
			return;
		}
		// Schema extraction is a server-side hard gate: the definition can't be
		// uploaded unless compute is reachable and returns a valid schema.
		if (!validationSchema) {
			toast.error(
				validationError ?? 'The definition must be validated against an online compute server first'
			);
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
		selectedFile = null;
		lastValidatedKey = null;
		if (imageInput) imageInput.value = '';
		imageHasFile = false;
	}

	function handleOpenChange(newOpen: boolean) {
		if (!newOpen) resetForm();
		onOpenChange?.(newOpen);
	}

	// Reset when the dialog is closed externally (e.g. after a successful submit).
	// bits-ui's onOpenChange only fires for internal closes (X / esc / outside click),
	// so we mirror the reset here for prop-driven closes.
	$effect(() => {
		if (!open) resetForm();
	});
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Add New Definition</Dialog.Title>
			<Dialog.Description>Upload a Grasshopper file and fill in the metadata.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4">
			<!-- Project & compute server -->
			{#if showProjectDropdown || computeServers.length > 0}
				<div
					class="grid gap-3 {showProjectDropdown && computeServers.length > 0
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
					{#if computeServers.length > 0}
						<div class="space-y-1">
							<Label for="new-server">Compute Server</Label>
							<select
								id="new-server"
								value={selectedComputeServerId || (defaultComputeServerId ?? '')}
								onchange={(e) => {
									const picked = (e.currentTarget as HTMLSelectElement).value;
									selectedComputeServerId = picked === defaultComputeServerId ? '' : picked;
								}}
								class="border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
							>
								{#each computeServers as s (s.id)}
									<option value={s.id}>
										{s.label}{s.id === defaultComputeServerId ? ' (Default)' : ''}
									</option>
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
					onchange={onFileChanged}
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
					<div class="border-destructive/40 bg-destructive/5 rounded-md border p-3">
						<p class="text-destructive text-xs font-medium">Validation failed</p>
						<p class="text-destructive/80 mt-0.5 text-xs">{validationError}</p>
						<p class="text-destructive/60 mt-1 text-xs">
							This definition can't be uploaded until it validates against an online compute server.
						</p>
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
					hasFile={imageHasFile}
					onModeChange={(m) => (imageMode = m)}
					onUpload={() => {}}
					onFileSelected={() => (imageHasFile = !!imageInput?.files?.length)}
					onUrlChange={(url) => (coverImage = url)}
					bind:inputRef={imageInput}
				/>
			</div>
		</div>

		<Dialog.Footer class="gap-2 sm:justify-end">
			<Button variant="outline" onclick={() => onOpenChange?.(false)}>Cancel</Button>
			<Button onclick={handleSubmit} disabled={isAdding || validating || !validationSchema}>
				{isAdding ? 'Creating…' : validating ? 'Validating…' : 'Create Definition'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
