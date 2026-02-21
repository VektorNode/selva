<script lang="ts">
	import {
		Button,
		Input,
		Label,
		Textarea,
		Badge,
		Card,
		Dialog,
		Separator,
		toast
	} from '@selva/shared';
	import { Plus, Trash2, Pencil, Upload, History } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		file?: string;
	}

	interface PageData {
		config: { [guid: string]: DefinitionConfig };
		history: { [guid: string]: string[] };
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// Local editable copy of config (GUID-keyed)
	let editableConfig = $state<{ [guid: string]: DefinitionConfig }>({});
	$effect(() => {
		const raw = JSON.parse(JSON.stringify(data.config)) as typeof editableConfig;
		// Normalize optional fields to empty strings so bind:value never receives undefined
		for (const cfg of Object.values(raw)) {
			cfg.description ??= '';
			cfg.category ??= '';
			cfg.coverImage ??= '';
		}
		editableConfig = raw;
	});

	// Per-definition state
	let editingDefinition = $state<string | null>(null);
	let savingDefinition = $state<{ [guid: string]: boolean }>({});
	let uploadingDefinitionFile = $state<{ [guid: string]: boolean }>({});
	let uploadingDefinitionImage = $state<{ [guid: string]: boolean }>({});
	let editModeFileInputs = $state<{ [guid: string]: HTMLInputElement }>({});
	let editModeImageInputs = $state<{ [guid: string]: HTMLInputElement }>({});
	let editImageModes = $state<{ [guid: string]: 'url' | 'upload' }>({});

	// Add modal state
	let showAddModal = $state(false);
	let addingDefinition = $state(false);
	let newDefDisplayName = $state('');
	let newDefDescription = $state('');
	let newDefCategory = $state('');
	let newDefTags = $state('');
	let newDefCoverImage = $state('');
	let newDefImageMode = $state<'url' | 'upload'>('url');
	let newDefFileInput = $state<HTMLInputElement | undefined>(undefined);
	let newDefImageInput = $state<HTMLInputElement | undefined>(undefined);
	let newDefValidating = $state(false);
	let newDefValidationError = $state<string | null>(null);
	let newDefValidationSchema = $state<ValidatedSchema | null>(null);

	// Validate section state
	interface ValidatedSchema {
		name: string;
		description: string;
		author: string;
		inputCount: number;
		outputCount: number;
		tags: string[];
	}
	interface ValidationResult {
		fileName: string;
		valid: boolean;
		error?: string;
		schemas?: ValidatedSchema[];
	}
	// Search and update state
	let searchQuery = $state('');
	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);

	const filteredDefinitions = $derived(
		Object.entries(editableConfig).filter(([_guid, cfg]) => {
			if (searchQuery === '') return true;
			const q = searchQuery.toLowerCase();
			return (
				cfg.displayName?.toLowerCase().includes(q) ||
				cfg.description?.toLowerCase().includes(q) ||
				cfg.file?.toLowerCase().includes(q)
			);
		})
	);

	async function getErrorMessage(response: Response, fallback: string): Promise<string> {
		if (response.headers.get('content-type')?.includes('application/json')) {
			const err = await response.json().catch(() => null);
			return err?.message || err?.error?.message || `${fallback} (${response.status})`;
		}
		return `${fallback} (${response.status})`;
	}

	function toggleEditDefinition(guid: string) {
		editingDefinition = editingDefinition === guid ? null : guid;
	}

	async function saveDefinition(guid: string) {
		savingDefinition[guid] = true;
		const cfg = editableConfig[guid];
		try {
			const response = await fetch(`/admin/api/definitions/${guid}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					displayName: cfg.displayName,
					description: cfg.description?.trim() || undefined,
					category: cfg.category?.trim() || undefined,
					tags: cfg.tags && cfg.tags.length > 0 ? cfg.tags : undefined,
					coverImage: cfg.coverImage ?? undefined
				})
			});

			if (response.ok) {
				toast.success('Definition saved');
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Save failed'));
			}
		} catch (err) {
			toast.error('Save failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			savingDefinition[guid] = false;
		}
	}

	async function deleteDefinition(guid: string) {
		const name = editableConfig[guid]?.displayName || guid;
		if (!confirm(`Delete "${name}" and all its files? This cannot be undone.`)) return;
		try {
			const response = await fetch(`/admin/api/definitions/${guid}`, { method: 'DELETE' });
			if (response.ok) {
				toast.success(`"${name}" deleted`);
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Delete failed'));
			}
		} catch (err) {
			toast.error('Delete failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		}
	}

	async function handleDefinitionFileUpload(guid: string) {
		const input = editModeFileInputs[guid];
		if (!input?.files || input.files.length === 0) {
			toast.error('Please select a file first');
			return;
		}
		uploadingDefinitionFile[guid] = true;
		const formData = new FormData();
		formData.append('file', input.files[0]);
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
			uploadingDefinitionFile[guid] = false;
			input.value = '';
		}
	}

	async function handleDefinitionImageUpload(guid: string) {
		const input = editModeImageInputs[guid];
		if (!input?.files?.length) {
			toast.error('Please select an image first');
			return;
		}
		uploadingDefinitionImage[guid] = true;
		const formData = new FormData();
		formData.append('image', input.files[0]);
		try {
			const response = await fetch(`/admin/api/definitions/${guid}/image`, {
				method: 'POST',
				body: formData
			});
			if (response.ok) {
				const result = await response.json();
				editableConfig[guid].coverImage = result.coverImage;
				toast.success('Image uploaded');
				await invalidateAll();
			} else {
				toast.error(await getErrorMessage(response, 'Image upload failed'));
			}
		} catch (err) {
			toast.error('Upload failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			uploadingDefinitionImage[guid] = false;
			input.value = '';
		}
	}

	async function submitAddDefinition() {
		if (!newDefDisplayName.trim()) {
			toast.error('Display name is required');
			return;
		}
		if (!newDefFileInput?.files || newDefFileInput.files.length === 0) {
			toast.error('A Grasshopper file is required');
			return;
		}
		addingDefinition = true;
		const formData = new FormData();
		// Text fields first — large binary last to avoid proxy truncation dropping metadata
		formData.append('displayName', newDefDisplayName.trim());
		formData.append('description', newDefDescription);
		formData.append('category', newDefCategory);
		formData.append('tags', newDefTags);
		if (newDefImageMode === 'upload' && newDefImageInput?.files?.[0]) {
			formData.append('image', newDefImageInput.files[0]);
		} else if (newDefImageMode === 'url' && newDefCoverImage.trim()) {
			formData.append('coverImage', newDefCoverImage.trim());
		}
		formData.append('file', newDefFileInput.files[0]);
		try {
			const response = await fetch('/admin/api/definitions', {
				method: 'POST',
				body: formData
			});
			if (response.ok) {
				toast.success(`"${newDefDisplayName}" created`);
				showAddModal = false;
				await invalidateAll(); // TEMP: disabled to inspect network request
			} else {
				toast.error(await getErrorMessage(response, 'Failed to create definition'));
			}
		} catch (err) {
			toast.error('Failed: ' + (err instanceof Error ? err.message : 'Unknown error'));
		} finally {
			addingDefinition = false;
		}
	}

	function openAddModal() {
		newDefDisplayName = '';
		newDefDescription = '';
		newDefCategory = '';
		newDefTags = '';
		newDefCoverImage = '';
		newDefImageMode = 'url';
		newDefValidating = false;
		newDefValidationError = null;
		newDefValidationSchema = null;
		if (newDefFileInput) newDefFileInput.value = '';
		if (newDefImageInput) newDefImageInput.value = '';
		showAddModal = true;
	}

	function nameFromFile(file: File): string {
		return file.name
			.replace(/\.(gh|ghx)$/i, '')
			.replace(/[_-]/g, ' ')
			.replace(/\b\w/g, (l) => l.toUpperCase());
	}

	async function onNewFileSelected() {
		const file = newDefFileInput?.files?.[0];
		if (!file) return;

		// Reset form + validation state for fresh file
		newDefDisplayName = '';
		newDefDescription = '';
		newDefTags = '';
		newDefValidationError = null;
		newDefValidationSchema = null;
		newDefValidating = true;

		const formData = new FormData();
		formData.append('files', file);

		try {
			const response = await fetch('/api/validate-solution', { method: 'POST', body: formData });

			if (response.status === 404) {
				// Endpoint doesn't exist — backwards-compatible fallback
				newDefDisplayName = nameFromFile(file);
				return;
			}

			if (!response.ok) {
				// Other server error — fall back silently
				newDefDisplayName = nameFromFile(file);
				return;
			}

			const results: ValidationResult[] = await response.json();
			const result = results[0];

			if (!result) {
				newDefDisplayName = nameFromFile(file);
				return;
			}

			if (!result.valid) {
				newDefValidationError = result.error ?? 'Validation failed';
				return;
			}

			// Valid — pre-fill from schema
			const schema = result.schemas?.[0] ?? null;
			newDefValidationSchema = schema;

			newDefDisplayName = schema?.name || nameFromFile(file);
			newDefDescription = schema?.description || '';
			newDefTags = schema?.tags?.join(', ') || '';
		} catch {
			// Network error / endpoint unreachable — fall back silently
			newDefDisplayName = nameFromFile(file);
		} finally {
			newDefValidating = false;
		}
	}

	async function runUpdate() {
		if (!confirm('Run the update script? This will restart the application.')) return;
		updateRunning = true;
		updateLogs = '';
		updateExitCode = null;
		try {
			const response = await fetch('/admin/api/update', { method: 'POST' });
			if (!response.ok) {
				updateLogs = 'Failed to start update process';
				updateRunning = false;
				return;
			}
			const reader = response.body?.getReader();
			const decoder = new TextDecoder();
			if (!reader) {
				updateLogs = 'Failed to read response';
				updateRunning = false;
				return;
			}
			let buffer = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop()!; // keep incomplete trailing chunk
				for (const part of parts) {
					if (!part.startsWith('data: ')) continue;
					try {
						const event = JSON.parse(part.slice(6));
						if (event.type === 'log') updateLogs += event.data + '\n';
						else if (event.type === 'exit') {
							updateExitCode = event.code;
							updateRunning = false;
						}
					} catch {
						// ignore malformed events
					}
				}
			}
		} catch (err) {
			updateLogs += '\nError: ' + (err instanceof Error ? err.message : 'Unknown error');
			updateRunning = false;
		}
	}
</script>

<svelte:head>
	<title>Admin Dashboard - Selva Compute</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<!-- Definition Manager -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Definitions</Card.Title>
					<Card.Description>
						{Object.keys(editableConfig).length} definition{Object.keys(editableConfig).length === 1
							? ''
							: 's'} configured
					</Card.Description>
				</div>
				<Button onclick={openAddModal}>
					<Plus class="mr-2 h-4 w-4" />
					Add Definition
				</Button>
			</div>
		</Card.Header>

		<Card.Content class="space-y-4">
			<!-- Search -->
			<Input type="text" bind:value={searchQuery} placeholder="Search definitions..." />

			<!-- Grid -->
			{#if filteredDefinitions.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<p class="text-sm font-medium">No definitions found</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{searchQuery ? 'Try adjusting your search' : 'Add your first definition to get started'}
					</p>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredDefinitions as [guid, cfg] (guid)}
						<Card.Root class="overflow-hidden pt-0">
							<!-- Cover image -->
							<div class="bg-muted h-32">
								{#if cfg.coverImage}
									<img
										src={cfg.coverImage}
										alt={cfg.displayName}
										class="h-full w-full object-cover"
									/>
								{/if}
							</div>

							<Card.Content class="p-4">
								<div class="mb-2 flex items-start justify-between">
									<div class="min-w-0 flex-1">
										<h4 class="line-clamp-1 text-sm font-semibold">{cfg.displayName || guid}</h4>
										<p class="text-muted-foreground mt-0.5 truncate text-xs">
											{cfg.file || 'No file'}
										</p>
									</div>
									<Button
										size="sm"
										variant="ghost"
										onclick={() => toggleEditDefinition(guid)}
										class="ml-2 h-8 w-8 shrink-0 p-0"
									>
										<Pencil class="h-4 w-4" />
									</Button>
								</div>

								<p class="text-muted-foreground mb-3 line-clamp-2 text-xs">
									{cfg.description || 'No description'}
								</p>

								{#if cfg.category}
									<div class="mb-2">
										<Badge>{cfg.category}</Badge>
									</div>
								{/if}

								{#if cfg.tags && cfg.tags.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each cfg.tags.slice(0, 3) as tag}
											<Badge variant="secondary">{tag}</Badge>
										{/each}
										{#if cfg.tags.length > 3}
											<span class="text-muted-foreground text-xs">+{cfg.tags.length - 3} more</span>
										{/if}
									</div>
								{/if}
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<!-- Edit Definition Dialog -->
	{#if editingDefinition && editableConfig[editingDefinition]}
		{@const guid = editingDefinition}
		{@const cfg = editableConfig[guid]}
		<Dialog.Root
			open={true}
			onOpenChange={(o) => {
				if (!o) editingDefinition = null;
			}}
		>
			<Dialog.Content class="max-w-lg">
				<Dialog.Header>
					<Dialog.Title>Edit — {cfg.displayName || guid}</Dialog.Title>
					<Dialog.Description class="font-mono text-xs">{guid}</Dialog.Description>
				</Dialog.Header>

				<div class="space-y-3">
					<div class="space-y-1">
						<Label for="dn-{guid}">Display Name</Label>
						<Input id="dn-{guid}" type="text" bind:value={cfg.displayName} />
					</div>
					<div class="space-y-1">
						<Label for="desc-{guid}">Description</Label>
						<Textarea id="desc-{guid}" rows={2} bind:value={cfg.description} />
					</div>
					<div class="grid grid-cols-2 gap-3">
						<div class="space-y-1">
							<Label for="cat-{guid}">Category</Label>
							<Input id="cat-{guid}" type="text" bind:value={cfg.category} />
						</div>
						<div class="space-y-1">
							<Label for="tags-{guid}">Tags</Label>
							<Input
								id="tags-{guid}"
								type="text"
								value={cfg.tags?.join(', ') || ''}
								oninput={(e: Event) => {
									const t = e.currentTarget as HTMLInputElement;
									cfg.tags = t.value
										.split(',')
										.map((s: string) => s.trim())
										.filter(Boolean);
								}}
								placeholder="comma, separated"
							/>
						</div>
					</div>

					<Separator />

					<!-- Cover image -->
					<div class="space-y-1">
						<Label>Cover Image</Label>
						<div class="flex gap-1 rounded-md border p-0.5">
							<Button
								size="sm"
								variant={(editImageModes[guid] ?? 'url') !== 'upload' ? 'default' : 'ghost'}
								onclick={() => (editImageModes[guid] = 'url')}
								class="h-7 flex-1 text-xs">URL</Button
							>
							<Button
								size="sm"
								variant={editImageModes[guid] === 'upload' ? 'default' : 'ghost'}
								onclick={() => (editImageModes[guid] = 'upload')}
								class="h-7 flex-1 text-xs">Upload File</Button
							>
						</div>
						{#if editImageModes[guid] === 'upload'}
							<div class="flex items-center gap-2">
								<input
									type="file"
									bind:this={editModeImageInputs[guid]}
									accept="image/*"
									class="border-input bg-background focus-visible:ring-ring flex h-10 flex-1 rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
								/>
								<Button
									size="sm"
									onclick={() => handleDefinitionImageUpload(guid)}
									disabled={uploadingDefinitionImage[guid]}
								>
									<Upload class="mr-2 h-4 w-4" />
									{uploadingDefinitionImage[guid] ? 'Uploading…' : 'Upload'}
								</Button>
							</div>
							{#if cfg.coverImage?.startsWith('/admin/api/definitions/')}
								<p class="text-muted-foreground text-xs">✓ Image saved in definition folder</p>
							{/if}
						{:else}
							<Input type="text" bind:value={cfg.coverImage} placeholder="https://..." />
						{/if}
					</div>

					<Separator />

					<!-- GH file -->
					<div class="space-y-1">
						<Label>Grasshopper File</Label>
						{#if cfg.file}
							<p class="text-muted-foreground text-xs">
								Current: <code class="font-mono">{cfg.file}</code>
							</p>
						{/if}
						<p class="text-muted-foreground text-xs">
							Upload to replace — old file archived with timestamp prefix.
						</p>
						<div class="flex items-center gap-2">
							<input
								type="file"
								bind:this={editModeFileInputs[guid]}
								accept=".gh,.ghx"
								class="border-input bg-background focus-visible:ring-ring flex h-10 flex-1 rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
							/>
							<Button
								size="sm"
								onclick={() => handleDefinitionFileUpload(guid)}
								disabled={uploadingDefinitionFile[guid]}
							>
								<Upload class="mr-2 h-4 w-4" />
								{uploadingDefinitionFile[guid] ? 'Uploading…' : 'Upload'}
							</Button>
						</div>
					</div>

					<!-- File history -->
					{#if data.history[guid]?.length > 0}
						<div class="space-y-1">
							<p class="text-muted-foreground flex items-center gap-1 text-xs font-medium">
								<History class="h-3 w-3" /> Archived versions
							</p>
							<ul class="space-y-0.5">
								{#each data.history[guid] as old}
									<li class="text-muted-foreground truncate font-mono text-xs">{old}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>

				<Dialog.Footer class="gap-2">
					<Button variant="destructive" onclick={() => deleteDefinition(guid)} class="mr-auto">
						<Trash2 class="mr-2 h-4 w-4" /> Delete
					</Button>
					<Button variant="outline" onclick={() => (editingDefinition = null)}>Cancel</Button>
					<Button onclick={() => saveDefinition(guid)} disabled={savingDefinition[guid]}>
						{savingDefinition[guid] ? 'Saving…' : 'Save'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}

	<!-- Add Definition Dialog -->
	{#if showAddModal}
		<Dialog.Root
			open={true}
			onOpenChange={(o) => {
				if (!o) showAddModal = false;
			}}
		>
			<Dialog.Content class="max-w-xl">
				<Dialog.Header>
					<Dialog.Title>Add New Definition</Dialog.Title>
					<Dialog.Description
						>Upload a Grasshopper file and fill in the metadata.</Dialog.Description
					>
				</Dialog.Header>

				<div class="space-y-4">
					<div class="space-y-2">
						<Label for="new-file">
							Grasshopper File <span class="text-destructive">*</span>
						</Label>
						<input
							id="new-file"
							type="file"
							accept=".gh,.ghx"
							bind:this={newDefFileInput}
							onchange={onNewFileSelected}
							class="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
						/>

						{#if newDefValidating}
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
						{:else if newDefValidationError}
							<div class="border-destructive/40 bg-destructive/5 rounded-md border p-3">
								<p class="text-destructive text-xs font-medium">Validation failed</p>
								<p class="text-destructive/80 mt-0.5 text-xs">{newDefValidationError}</p>
							</div>
						{:else if newDefValidationSchema}
							<div
								class="flex items-center gap-3 rounded-md border border-green-500/30 bg-green-500/5 p-3"
							>
								<div class="min-w-0 flex-1">
									<p class="text-xs font-medium text-green-700 dark:text-green-400">
										Valid Selva definition
									</p>
									<p class="text-muted-foreground mt-0.5 text-xs">
										{newDefValidationSchema.inputCount} input{newDefValidationSchema.inputCount ===
										1
											? ''
											: 's'},
										{newDefValidationSchema.outputCount} output{newDefValidationSchema.outputCount ===
										1
											? ''
											: 's'}
									</p>
								</div>
							</div>
						{/if}
					</div>

					<div class="space-y-2">
						<Label for="new-dn">Display Name <span class="text-destructive">*</span></Label>
						<Input
							id="new-dn"
							type="text"
							bind:value={newDefDisplayName}
							placeholder="e.g., Parametric Tower"
						/>
					</div>

					<div class="space-y-2">
						<Label for="new-desc">Description</Label>
						<Textarea
							id="new-desc"
							bind:value={newDefDescription}
							rows={3}
							placeholder="Describe what this definition does…"
						/>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="new-cat">Category</Label>
							<Input
								id="new-cat"
								type="text"
								bind:value={newDefCategory}
								placeholder="e.g., Architecture"
							/>
						</div>
						<div class="space-y-2">
							<Label for="new-tags">Tags</Label>
							<Input
								id="new-tags"
								type="text"
								bind:value={newDefTags}
								placeholder="parametric, tower"
							/>
						</div>
					</div>

					<div class="space-y-2">
						<Label>Cover Image</Label>
						<!-- URL / Upload toggle -->
						<div class="flex gap-1 rounded-md border p-0.5">
							<Button
								size="sm"
								variant={newDefImageMode !== 'upload' ? 'default' : 'ghost'}
								onclick={() => (newDefImageMode = 'url')}
								class="h-7 flex-1 text-xs">URL</Button
							>
							<Button
								size="sm"
								variant={newDefImageMode === 'upload' ? 'default' : 'ghost'}
								onclick={() => (newDefImageMode = 'upload')}
								class="h-7 flex-1 text-xs">Upload File</Button
							>
						</div>
						{#if newDefImageMode === 'upload'}
							<input
								type="file"
								bind:this={newDefImageInput}
								accept="image/*"
								class="border-input bg-background focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
							/>
						{:else}
							<Input
								id="new-img"
								type="text"
								bind:value={newDefCoverImage}
								placeholder="https://..."
							/>
						{/if}
					</div>
				</div>
				<Dialog.Footer class="gap-2 sm:justify-end">
					<Button variant="outline" onclick={() => (showAddModal = false)}>Cancel</Button>
					<Button
						onclick={submitAddDefinition}
						disabled={addingDefinition || newDefValidating || !!newDefValidationError}
					>
						{addingDefinition
							? 'Creating…'
							: newDefValidating
								? 'Validating…'
								: 'Create Definition'}
					</Button>
				</Dialog.Footer>
			</Dialog.Content>
		</Dialog.Root>
	{/if}

	<!-- Application Update -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Application Update</Card.Title>
			<Card.Description>Run the update script to pull latest changes and restart</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<Button onclick={runUpdate} disabled={updateRunning} variant="destructive">
				{updateRunning ? 'Running…' : 'Run Update'}
			</Button>
			{#if updateLogs}
				<div class="space-y-2">
					<h4 class="text-sm font-medium">Update Logs</h4>
					<pre
						class="bg-muted text-foreground max-h-96 overflow-auto rounded-md p-4 font-mono text-xs">{updateLogs}</pre>
					{#if updateExitCode !== null}
						<p
							class="text-sm font-medium {updateExitCode === 0
								? 'text-green-600 dark:text-green-400'
								: 'text-destructive'}"
						>
							Process exited with code: {updateExitCode}
						</p>
					{/if}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>
</div>

<style>
</style>
