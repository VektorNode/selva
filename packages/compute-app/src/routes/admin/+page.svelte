<script lang="ts">
	import {
		Button,
		Input,
		Label,
		Textarea,
		Badge,
		Card,
		Dialog,
		Select,
		Separator,
		toast
	} from '@selva/shared';
	import { Plus, Trash2, Pencil, Upload, CheckCircle, AlertCircle } from '@lucide/svelte';
	import { invalidateAll } from '$app/navigation';

	interface DefinitionConfig {
		displayName: string;
		description: string;
		category?: string;
		tags?: string[];
		coverImage?: string;
		guid?: string;
	}

	interface DefinitionsConfig {
		[key: string]: DefinitionConfig;
	}

	interface FileInfo {
		name: string;
		type: 'grasshopper' | 'image' | 'other';
	}

	interface PageData {
		files: FileInfo[];
		config: DefinitionsConfig;
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	let uploadInput = $state<HTMLInputElement>();
	let uploading = $state(false);

	let savingConfig = $state(false);

	let updateRunning = $state(false);
	let updateLogs = $state('');
	let updateExitCode = $state<number | null>(null);

	// Local copy of config for editing - needs to update when data changes
	let editableConfig = $state<DefinitionsConfig>({});

	// Initialize and update editableConfig when data changes
	$effect(() => {
		editableConfig = JSON.parse(JSON.stringify(data.config));
	});

	// Modal state for adding new definitions
	let showAddModal = $state(false);
	let newDefKey = $state('');
	let newDefDisplayName = $state('');
	let newDefDescription = $state('');
	let newDefCategory = $state('');
	let newDefTags = $state('');
	let newDefCoverImage = $state('');

	// Editing state
	let editingDefinition = $state<string | null>(null);
	let searchQuery = $state('');
	let editModeFileInputs = $state<{ [key: string]: HTMLInputElement }>({});
	let uploadingDefinitionFile = $state<{ [key: string]: boolean }>({});

	// Auto-fill display name when file is selected
	$effect(() => {
		if (newDefKey && !newDefDisplayName) {
			// Remove file extension and convert to readable format
			newDefDisplayName = newDefKey
				.replace(/\.(gh|ghx)$/i, '')
				.replace(/[_-]/g, ' ')
				.replace(/\b\w/g, (l) => l.toUpperCase());
		}
	});

	async function handleFileUpload() {
		if (!uploadInput?.files || uploadInput.files.length === 0) {
			toast.error('Please select a file first');
			return;
		}

		uploading = true;
		const uploadedFile = uploadInput.files[0];
		const isGrasshopper = uploadedFile.name.endsWith('.gh') || uploadedFile.name.endsWith('.ghx');

		const formData = new FormData();
		formData.append('file', uploadedFile);

		console.log(`[Upload] Starting upload: ${uploadedFile.name}, isGrasshopper: ${isGrasshopper}`);

		// For GH files, auto-detect if it's an update
		if (isGrasshopper) {
			const isUpdate = !!editableConfig[uploadedFile.name]; // Update if filename exists in config
			const guid = isUpdate ? editableConfig[uploadedFile.name].guid : undefined;

			console.log(`[Upload] GH file - isUpdate: ${isUpdate}, guid: ${guid}`);

			formData.append('isUpdate', isUpdate.toString());
			if (guid) formData.append('guid', guid);

			try {
				const response = await fetch('/admin/api/definitions', {
					method: 'POST',
					body: formData
				});

				console.log(`[Upload] Response status: ${response.status}`);

				if (response.ok) {
					const result = await response.json();
					console.log(`[Upload] Success:`, result);
					toast.success(
						`Definition "${result.filename}" ${isUpdate ? 'updated' : 'created'} successfully${isUpdate ? ' (old version backed up)' : ''}`
					);
					await invalidateAll();
					location.reload();
				} else {
					const errorText = await response.text();
					console.error(`[Upload] Error response:`, errorText);
					try {
						const error = JSON.parse(errorText);
						toast.error(error.message || 'Upload failed');
					} catch {
						toast.error(`Upload failed: ${response.status} ${response.statusText}`);
					}
				}
			} catch (error) {
				console.error(`[Upload] Exception:`, error);
				toast.error('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
			}
		} else {
			// For images, use the old endpoint
			console.log(`[Upload] Image file`);

			try {
				const response = await fetch('/admin/api/files', {
					method: 'POST',
					body: formData
				});

				console.log(`[Upload] Response status: ${response.status}`);

				if (response.ok) {
					const result = await response.json();
					console.log(`[Upload] Success:`, result);
					toast.success(`Image "${result.filename}" uploaded successfully`);
					await invalidateAll();
					location.reload();
				} else {
					const errorText = await response.text();
					console.error(`[Upload] Error response:`, errorText);
					try {
						const error = JSON.parse(errorText);
						toast.error(error.message || 'Upload failed');
					} catch {
						toast.error(`Upload failed: ${response.status} ${response.statusText}`);
					}
				}
			} catch (error) {
				console.error(`[Upload] Exception:`, error);
				toast.error('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
			}
		}

		uploading = false;
		if (uploadInput) uploadInput.value = '';
	}

	async function deleteFile(filename: string) {
		const isGrasshopper = filename.endsWith('.gh') || filename.endsWith('.ghx');

		// If it's a GH file, check if it's in use
		if (isGrasshopper) {
			if (editableConfig[filename]) {
				toast.error(
					`Cannot delete "${filename}" - it's being used by a definition. Remove it from the definition first.`
				);
				return;
			}
		}

		if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

		try {
			const response = await fetch(`/admin/api/files?filename=${encodeURIComponent(filename)}`, {
				method: 'DELETE'
			});

			if (response.ok) {
				toast.success(`File "${filename}" deleted`);
				await invalidateAll();
				location.reload();
			} else {
				const error = await response.json();
				toast.error(error.error || 'Delete failed');
			}
		} catch (error) {
			toast.error('Delete failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
		}
	}

	async function handleDefinitionFileUpload(key: string) {
		const input = editModeFileInputs[key];
		if (!input?.files || input.files.length === 0) {
			toast.error('Please select a file first');
			return;
		}

		const uploadedFile = input.files[0];
		const guid = editableConfig[key]?.guid;

		if (!guid) {
			toast.error('Definition GUID not found');
			return;
		}

		uploadingDefinitionFile[key] = true;

		const formData = new FormData();
		formData.append('file', uploadedFile);
		formData.append('guid', guid);

		try {
			const response = await fetch('/admin/api/definitions/upload', {
				method: 'POST',
				body: formData
			});

			if (response.ok) {
				const result = await response.json();
				toast.success(`Definition file "${result.filename}" uploaded successfully`);
				await invalidateAll();
				location.reload();
			} else {
				const error = await response.json();
				toast.error(error.message || 'Upload failed');
			}
		} catch (error) {
			toast.error('Upload failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
		} finally {
			uploadingDefinitionFile[key] = false;
			input.value = '';
		}
	}

	async function saveConfig() {
		savingConfig = true;

		try {
			const response = await fetch('/admin/api/config', {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(editableConfig)
			});

			if (response.ok) {
				toast.success('Configuration saved successfully');
				await invalidateAll();
				location.reload();
			} else {
				const error = await response.json();
				toast.error(error.error || 'Save failed');
			}
		} catch (error) {
			toast.error('Save failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
		} finally {
			savingConfig = false;
		}
	}

	async function runUpdate() {
		if (
			!confirm('Are you sure you want to run the update script? This will restart the application.')
		)
			return;

		updateRunning = true;
		updateLogs = '';
		updateExitCode = null;

		try {
			const response = await fetch('/admin/api/update', {
				method: 'POST'
			});

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

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				const chunk = decoder.decode(value);
				const lines = chunk.split('\n\n');

				for (const line of lines) {
					if (!line.startsWith('data: ')) continue;
					const data = line.slice(6);

					try {
						const event = JSON.parse(data);
						if (event.type === 'log') {
							updateLogs += event.data + '\n';
						} else if (event.type === 'exit') {
							updateExitCode = event.code;
							updateRunning = false;
						}
					} catch (e) {
						// Ignore JSON parse errors
					}
				}
			}
		} catch (error) {
			updateLogs += '\nError: ' + (error instanceof Error ? error.message : 'Unknown error');
			updateRunning = false;
		}
	}

	function addDefinition() {
		// Reset modal state
		newDefKey = '';
		newDefDisplayName = '';
		newDefDescription = '';
		newDefCategory = '';
		newDefTags = '';
		newDefCoverImage = '';
		showAddModal = true;
	}

	function cancelAddDefinition() {
		showAddModal = false;
	}

	function generateGUID(): string {
		return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
			const r = (Math.random() * 16) | 0;
			const v = c === 'x' ? r : (r & 0x3) | 0x8;
			return v.toString(16);
		});
	}

	function confirmAddDefinition() {
		if (!newDefKey.trim()) {
			alert('Filename is required');
			return;
		}

		// Check if key already exists
		if (editableConfig[newDefKey]) {
			alert('A definition with this filename already exists');
			return;
		}

		// Add the new definition with GUID
		editableConfig[newDefKey] = {
			displayName: newDefDisplayName,
			description: newDefDescription,
			category: newDefCategory,
			tags: newDefTags
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean),
			coverImage: newDefCoverImage,
			guid: generateGUID()
		};

		showAddModal = false;
	}

	function removeDefinition(key: string) {
		if (!confirm(`Remove "${key}" from config?`)) return;
		delete editableConfig[key];
		editableConfig = editableConfig;
	}

	function toggleEditDefinition(key: string) {
		editingDefinition = editingDefinition === key ? null : key;
	}

	// Get filtered files (only GH and image files)
	const filteredFilesList = $derived(
		data.files.filter((f) => f.type === 'grasshopper' || f.type === 'image')
	);

	// Get available Grasshopper files for the dropdown
	const grasshopperFiles = $derived(
		filteredFilesList.filter((f) => f.type === 'grasshopper').map((f) => f.name)
	);

	// Get available image files for the dropdown
	const imageFiles = $derived(data.files.filter((f) => f.type === 'image').map((f) => f.name));

	// Filter definitions based on search
	const filteredDefinitions = $derived(
		Object.entries(editableConfig).filter(
			([key, config]) =>
				searchQuery === '' ||
				key.toLowerCase().includes(searchQuery.toLowerCase()) ||
				config.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
				config.description.toLowerCase().includes(searchQuery.toLowerCase())
		)
	);

	// Stats for files
	const ghFiles = $derived(filteredFilesList.filter((f) => f.type === 'grasshopper'));
	const configuredCount = $derived(ghFiles.filter((f) => editableConfig[f.name]).length);
	const unconfiguredCount = $derived(ghFiles.length - configuredCount);
</script>

<svelte:head>
	<title>Admin Dashboard - Selva Compute</title>
</svelte:head>

<div class="w-full space-y-6 p-6 lg:px-12 xl:px-16">
	<div>
		<h2 class="text-3xl font-bold tracking-tight">Dashboard</h2>
		<p class="text-muted-foreground">Manage your Grasshopper definitions and files</p>
	</div>

	<!-- Files Section -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Files</Card.Title>
			<Card.Description>Manage Grasshopper definitions and images</Card.Description>

			<!-- Summary Stats -->
			{#if ghFiles.length > 0}
				<div class="mt-4 flex gap-4">
					<Card.Root class="border-green-200 bg-green-50">
						<Card.Content class="p-4">
							<div class="text-2xl font-bold text-green-700">{configuredCount}</div>
							<div class="text-xs text-green-600">Configured</div>
						</Card.Content>
					</Card.Root>
					{#if unconfiguredCount > 0}
						<Card.Root class="border-yellow-200 bg-yellow-50">
							<Card.Content class="p-4">
								<div class="text-2xl font-bold text-yellow-700">{unconfiguredCount}</div>
								<div class="text-xs text-yellow-600">Need Configuration</div>
							</Card.Content>
						</Card.Root>
					{/if}
					<Card.Root class="bg-muted">
						<Card.Content class="p-4">
							<div class="text-2xl font-bold">{filteredFilesList.length}</div>
							<div class="text-muted-foreground text-xs">Total Files (GH & Images)</div>
						</Card.Content>
					</Card.Root>
				</div>
			{/if}
		</Card.Header>

		<Card.Content class="space-y-6">
			<!-- Upload Section -->
			<div class="space-y-2">
				<Label>Upload File</Label>
				<div class="flex items-center gap-2">
					<input
						type="file"
						bind:this={uploadInput}
						accept=".gh,.ghx,.jpg,.jpeg,.png,.gif,.webp"
						class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 w-full rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
					/>
					<Button onclick={handleFileUpload} disabled={uploading}>
						<Upload class="mr-2 h-4 w-4" />
						{uploading ? 'Uploading...' : 'Upload'}
					</Button>
				</div>
				<div
					class="text-muted-foreground rounded border border-blue-200 bg-blue-50 p-2 text-xs dark:border-blue-800 dark:bg-blue-950"
				>
					<strong>💡 How Updates Work:</strong>
					<ul class="mt-1 space-y-1">
						<li>
							• <strong>New file:</strong> Upload a GH file with a new name → Gets a GUID automatically
						</li>
						<li>
							• <strong>Update:</strong> Upload a GH file with the same name as existing definition
							→ Old version backed up to <code class="text-xs">/backups</code>, GUID preserved
						</li>
						<li>
							• <strong>Delete:</strong> GH files in use by definitions cannot be deleted (shows 📌 In
							Use)
						</li>
					</ul>
				</div>
			</div>

			<Separator />

			<!-- File List -->
			<div class="space-y-2">
				<h4 class="text-sm font-medium">Current Files</h4>
				<div class="space-y-2">
					{#each filteredFilesList as file}
					{@const isConfigured = file.type === 'grasshopper' && !!editableConfig[file.name]}
						<div
							class="flex items-center justify-between rounded-lg border p-3 {isConfigured
								? 'border-green-200 bg-green-50'
								: 'bg-background'}"
						>
							<div class="flex items-center gap-2">
								<Badge
									variant={file.type === 'grasshopper'
										? isConfigured
											? 'default'
											: 'secondary'
										: file.type === 'image'
											? 'outline'
											: 'secondary'}
								>
									{file.type}
								</Badge>
								<span class="text-sm font-medium">{file.name}</span>
								{#if file.type === 'grasshopper' && !isConfigured}
									<Badge variant="secondary" class="bg-yellow-100 text-yellow-800">
										<AlertCircle class="mr-1 h-3 w-3" />
										Not configured
									</Badge>
								{:else if isConfigured}
									<Badge variant="default" class="bg-green-100 text-green-800">
										<CheckCircle class="mr-1 h-3 w-3" />
										Configured
									</Badge>
								{/if}
							</div>
							<div class="flex items-center gap-2">
								{#if file.type === 'grasshopper' && !isConfigured}
									<Button
										size="sm"
										variant="ghost"
										onclick={() => {
											newDefKey = file.name;
											newDefDisplayName = file.name.replace(/\.(gh|ghx)$/, '');
											newDefDescription = '';
											newDefCategory = '';
											newDefTags = '';
											newDefCoverImage = '';
											showAddModal = true;
										}}
									>
										Configure
									</Button>
								{:else if file.type === 'grasshopper' && isConfigured}
									<span
										class="rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-700"
										title="Remove from definition to delete"
									>
										📌 In Use
									</span>
								{/if}
								<Button
									size="sm"
									variant="destructive"
									disabled={file.type === 'grasshopper' && isConfigured}
									title={file.type === 'grasshopper' && isConfigured
										? 'Remove from definition first'
										: 'Delete file'}
									onclick={() => deleteFile(file.name)}
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">No files found</p>
					{/each}
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Metadata Editor Section -->
	<Card.Root>
		<Card.Header>
			<div class="flex items-center justify-between">
				<div>
					<Card.Title>Definition Manager</Card.Title>
					<Card.Description>Configure metadata for your Grasshopper definitions</Card.Description>
				</div>
				<Button onclick={addDefinition}>
					<Plus class="mr-2 h-4 w-4" />
					Add Definition
				</Button>
			</div>
		</Card.Header>

		<Card.Content class="space-y-6">
			<!-- Search bar -->
			<div class="relative">
				<Input type="text" bind:value={searchQuery} placeholder="Search definitions..." />
			</div>

			<!-- Definitions Grid -->
			{#if filteredDefinitions.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center"
				>
					<p class="text-sm font-medium">No definitions found</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{searchQuery
							? 'Try adjusting your search'
							: 'Get started by adding your first definition'}
					</p>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each filteredDefinitions as [key, config]}
						<Card.Root class="overflow-hidden">
							<!-- Card Header with Cover Image -->
							<div class=" h-32">
								{#if config.coverImage}
									<img
										src={config.coverImage.startsWith('http')
											? config.coverImage
											: `/admin/api/images/${config.coverImage}`}
										alt={config.displayName}
										class="h-full w-full object-cover"
									/>
								{/if}
							</div>

							<!-- Card Content -->
							<Card.Content class=" p-4">
								<div class="mb-2 flex items-start justify-between">
									<div class="flex-1">
										<h4 class="line-clamp-1 text-sm font-semibold">
											{config.displayName || key}
										</h4>
										<p class="text-muted-foreground mt-0.5 text-xs">{key}</p>
									</div>
									<Button
										size="sm"
										variant="ghost"
										onclick={() => toggleEditDefinition(key)}
										class="h-8 w-8 p-0"
									>
										<Pencil class="h-4 w-4" />
									</Button>
								</div>

								<p class="text-muted-foreground mb-3 line-clamp-2 text-xs">
									{config.description || 'No description'}
								</p>

								{#if config.category}
									<div class="mb-2">
										<Badge>{config.category}</Badge>
									</div>
								{/if}

								{#if config.tags && config.tags.length > 0}
									<div class="flex flex-wrap gap-1">
										{#each config.tags.slice(0, 3) as tag}
											<Badge variant="secondary">{tag}</Badge>
										{/each}
										{#if config.tags.length > 3}
											<span class="text-muted-foreground text-xs"
												>+{config.tags.length - 3} more</span
											>
										{/if}
									</div>
								{/if}

								<!-- Expanded Edit Form -->
								{#if editingDefinition === key}
									<Separator class="my-4" />
									<div class="space-y-3">
										<div class="space-y-1">
											<Label for="display-name-{key}">Display Name</Label>
											<Input id="display-name-{key}" type="text" bind:value={config.displayName} />
										</div>
										<div class="space-y-1">
											<Label for="description-{key}">Description</Label>
											<Textarea id="description-{key}" rows={2} bind:value={config.description} />
										</div>
										<div class="space-y-1">
											<Label for="category-{key}">Category</Label>
											<Input id="category-{key}" type="text" bind:value={config.category} />
										</div>
										<div class="space-y-1">
											<Label for="tags-{key}">Tags</Label>
											<Input
												id="tags-{key}"
												type="text"
												value={config.tags?.join(', ') || ''}
												oninput={(e: Event) => {
													const target = e.currentTarget as HTMLInputElement;
													config.tags = target.value
														.split(',')
														.map((t: string) => t.trim())
														.filter(Boolean);
												}}
												placeholder="comma, separated, tags"
											/>
										</div>
										<div class="space-y-1">
											<Label for="cover-{key}">Cover Image</Label>
											<div class="space-y-2">
												<p class="text-muted-foreground text-xs">Select local image or paste URL</p>
												<Select.Root
													type="single"
													value={config.coverImage?.startsWith('http')
														? ''
														: config.coverImage || ''}
													onValueChange={(v: string | undefined) => {
														config.coverImage = v;
													}}
												>
													<Select.Trigger id="cover-{key}" class="w-full">
														{#if config.coverImage?.startsWith('http')}
															Custom URL
														{:else}
															{config.coverImage || 'No image'}
														{/if}
													</Select.Trigger>
													<Select.Content>
														<Select.Item value="" label="No image" />
														{#each imageFiles as imgFile}
															<Select.Item value={imgFile} label={imgFile} />
														{/each}
													</Select.Content>
												</Select.Root>
												<Input
													type="text"
													placeholder="Or paste image URL (https://...)"
													value={config.coverImage?.startsWith('http') ? config.coverImage : ''}
													oninput={(e: Event) => {
														const target = e.currentTarget as HTMLInputElement;
														if (target.value.trim()) {
															config.coverImage = target.value.trim();
														}
													}}
												/>
											</div>
										</div>

										<!-- Definition File Upload -->
										<div class="space-y-2">
											<Label for="def-file-{key}">Grasshopper File</Label>
											<div class="flex flex-col gap-2">
												<p class="text-muted-foreground text-xs">
													Upload a .gh or .ghx file for this definition. Old files will be
													automatically archived.
												</p>
												<div class="flex items-center gap-2">
													<input
														type="file"
														bind:this={editModeFileInputs[key]}
														accept=".gh,.ghx"
														id="def-file-{key}"
														class="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex h-10 flex-1 rounded-md border px-3 py-2 text-sm file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
													/>
													<Button
														size="sm"
														onclick={() => handleDefinitionFileUpload(key)}
														disabled={uploadingDefinitionFile[key]}
													>
														<Upload class="mr-2 h-4 w-4" />
														{uploadingDefinitionFile[key] ? 'Uploading...' : 'Upload'}
													</Button>
												</div>
											</div>
										</div>

										<div class="flex gap-2 pt-2">
											<Button
												class="flex-1"
												variant="secondary"
												onclick={() => toggleEditDefinition(key)}
											>
												Done
											</Button>
											<Button variant="destructive" onclick={() => removeDefinition(key)}>
												<Trash2 class="h-4 w-4" />
											</Button>
										</div>
									</div>
								{/if}
							</Card.Content>
						</Card.Root>
					{/each}
				</div>
			{/if}

			<Separator class="my-6" />

			<!-- Save Button -->
			<div class="flex items-center justify-end">
				<Button onclick={saveConfig} disabled={savingConfig} size="lg">
					{savingConfig ? 'Saving...' : 'Save All Changes'}
				</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Add Definition Dialog -->
	<Dialog.Root bind:open={showAddModal}>
		<Dialog.Content class="max-w-2xl">
			<Dialog.Header>
				<Dialog.Title>Add New Definition</Dialog.Title>
				<Dialog.Description>Fill in the details for your Grasshopper definition</Dialog.Description>
			</Dialog.Header>

			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="new-gh-file">
						Grasshopper File <span class="text-destructive">*</span>
					</Label>
					<Select.Root
						type="single"
						value={newDefKey}
						onValueChange={(v: string | undefined) => {
							newDefKey = v || '';
						}}
					>
						<Select.Trigger id="new-gh-file" class="w-full">
							{newDefKey || 'Select a file...'}
						</Select.Trigger>
						<Select.Content>
							{#each grasshopperFiles as ghFile}
								{#if !editableConfig[ghFile]}
									<Select.Item value={ghFile} label={ghFile} />
								{/if}
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">Choose from uploaded .gh or .ghx files</p>
				</div>

				<div class="space-y-2">
					<Label for="new-display-name">
						Display Name <span class="text-destructive">*</span>
					</Label>
					<Input
						id="new-display-name"
						type="text"
						bind:value={newDefDisplayName}
						placeholder="e.g., Parametric Tower"
					/>
				</div>

				<div class="space-y-2">
					<Label for="new-description">Description</Label>
					<Textarea
						id="new-description"
						bind:value={newDefDescription}
						rows={3}
						placeholder="Describe what this definition does..."
					/>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-2">
						<Label for="new-category">Category</Label>
						<Input
							id="new-category"
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
							placeholder="parametric, tower, design"
						/>
					</div>
				</div>

				<div class="space-y-2">
					<Label for="new-cover">Cover Image</Label>
					<div class="space-y-2">
						<p class="text-muted-foreground text-xs">Select local image or paste URL</p>
						<Select.Root
							type="single"
							value={newDefCoverImage.startsWith('http') ? '' : newDefCoverImage}
							onValueChange={(v: string | undefined) => {
								newDefCoverImage = v || '';
							}}
						>
							<Select.Trigger id="new-cover" class="w-full">
								{#if newDefCoverImage.startsWith('http')}
									Custom URL
								{:else}
									{newDefCoverImage || 'No image'}
								{/if}
							</Select.Trigger>
							<Select.Content>
								<Select.Item value="" label="No image" />
								{#each imageFiles as imgFile}
									<Select.Item value={imgFile} label={imgFile} />
								{/each}
							</Select.Content>
						</Select.Root>
						<Input
							type="text"
							placeholder="Or paste image URL (https://...)"
							value={newDefCoverImage.startsWith('http') ? newDefCoverImage : ''}
							oninput={(e: Event) => {
								const target = e.currentTarget as HTMLInputElement;
								if (target.value.trim()) {
									newDefCoverImage = target.value.trim();
								}
							}}
						/>
					</div>
					{#if imageFiles.length === 0}
						<p class="text-muted-foreground text-xs">Upload an image first or use external URL</p>
					{/if}
				</div>
			</div>

			<Dialog.Footer class="flex gap-2 sm:justify-end">
				<Button variant="outline" onclick={cancelAddDefinition}>Cancel</Button>
				<Button onclick={confirmAddDefinition}>Add Definition</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Update Section -->
	<Card.Root>
		<Card.Header>
			<Card.Title>Application Update</Card.Title>
			<Card.Description>Run update script to pull latest changes and restart</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<Button onclick={runUpdate} disabled={updateRunning} variant="destructive">
				{updateRunning ? 'Running...' : 'Run Update'}
			</Button>

			{#if updateLogs}
				<div class="space-y-2">
					<h4 class="text-sm font-medium">Update Logs</h4>
					<pre
						class="max-h-96 overflow-auto rounded-md bg-slate-950 p-4 text-xs text-slate-50">{updateLogs}</pre>
					{#if updateExitCode !== null}
						<p
							class="text-sm {updateExitCode === 0
								? 'text-green-600 dark:text-green-400'
								: 'text-red-600 dark:text-red-400'}"
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
