<script lang="ts">
	import { Download, Upload, AlertTriangle, CheckCircle } from '@lucide/svelte';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import {
		createSavedState,
		validateSavedState,
		extractLoadableValues,
		exportStateAsJson,
		importStateFromJson
	} from '../../schema/param-exporter';
	import { Button, Input, Label, Textarea, Dialog, Card } from '../primitives';

	import type { ActionButton } from '../../types/actionButton';

	interface Props {
		schema: UISchema;
		currentValues: Record<string, unknown>;
		onLoadValues: (values: Record<string, unknown>) => void;
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		actions?: ActionButton[];
	}

	let {
		schema,
		currentValues,
		onLoadValues,
		showSaveButton = true,
		showLoadButton = true,
		actions = []
	}: Props = $props();

	// Save dialog state
	let showExportDialog = $state(false);
	let exportName = $state('');
	let exportDescription = $state('');
	let exportAuthor = $state('');
	let exportTags = $state('');

	// Import/validation state
	let showValidationDialog = $state(false);
	let showLoadDialog = $state(false);
	let importedState = $state<ParameterPreset | null>(null);
	let validationResult = $state<ReturnType<typeof validateSavedState> | null>(null);
	let fileInputRef = $state<HTMLInputElement | null>(null);

	function openExportDialog() {
		exportName = `State ${new Date().toLocaleDateString()}`;
		exportDescription = '';
		exportAuthor = schema.author || '';
		exportTags = '';
		showExportDialog = true;
	}

	function handleExport() {
		if (!exportName.trim()) {
			alert('Please enter a name for this state');
			return;
		}

		const state = createSavedState(schema, currentValues, {
			name: exportName.trim(),
			description: exportDescription.trim() || undefined,
			author: exportAuthor.trim() || undefined,
			tags: exportTags
				.split(',')
				.map((t) => t.trim())
				.filter((t) => t.length > 0)
		});

		exportStateAsJson(state);
		showExportDialog = false;
	}

	async function handleImport(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		try {
			const file = input.files[0];
			const imported = await importStateFromJson(file);

			// Validate before loading
			const validation = validateSavedState(imported, schema);

			if (!validation.canLoad) {
				// Show validation errors
				importedState = imported;
				validationResult = validation;
				showValidationDialog = true;
				return;
			}

			// Warnings only - show validation but allow load
			if (!validation.isValid) {
				importedState = imported;
				validationResult = validation;
				showValidationDialog = true;
				return;
			}

			// No issues - load immediately
			const values = extractLoadableValues(imported, schema, validation);
			onLoadValues(values);
		} catch (error) {
			alert('Failed to import state: ' + (error as Error).message);
		}

		// Reset input
		input.value = '';
	}

	function confirmLoad() {
		if (!importedState || !validationResult) return;

		if (validationResult.canLoad) {
			const values = extractLoadableValues(importedState, schema, validationResult);
			onLoadValues(values);
			showValidationDialog = false;
			importedState = null;
			validationResult = null;
		}
	}

	function cancelImport() {
		showValidationDialog = false;
		importedState = null;
		validationResult = null;
	}

	function openLoadDialog() {
		showLoadDialog = true;
	}

	function handleLoadClick() {
		fileInputRef?.click();
		showLoadDialog = false;
	}
</script>

{#if showSaveButton}
	<Button variant="default" size="sm" onclick={openExportDialog}>
		<Download class="mr-2 h-4 w-4" />
		Save State
	</Button>
{/if}

{#if showLoadButton}
	<Button variant="outline" size="sm" onclick={openLoadDialog}>
		<Upload class="mr-2 h-4 w-4" />
		Load State
	</Button>
{/if}

{#each actions as action (action.id)}
	<Button variant={action.variant ?? 'outline'} size={action.size ?? 'sm'} onclick={action.onclick}>
		{#if action.icon}
			{@const IconComponent = action.icon}
			<IconComponent class="mr-2 h-4 w-4" />
		{/if}
		{action.label}
	</Button>
{/each}

<input bind:this={fileInputRef} type="file" accept=".sps" onchange={handleImport} class="hidden" />

<!-- Save Dialog -->
<Dialog.Root bind:open={showExportDialog}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Save Parameter State</Dialog.Title>
			<Dialog.Description>Save the current parameter values as a .sps file</Dialog.Description>
		</Dialog.Header>

		<div class="gap-4 py-4 grid">
			<div class="gap-2 grid">
				<Label for="export-name">State Name *</Label>
				<Input id="export-name" bind:value={exportName} placeholder="e.g., Design Option A" />
			</div>

			<div class="gap-2 grid">
				<Label for="export-description">Description</Label>
				<Textarea
					id="export-description"
					bind:value={exportDescription}
					placeholder="Optional description of this state"
					rows={3}
				/>
			</div>

			<div class="gap-2 grid">
				<Label for="export-author">Author</Label>
				<Input id="export-author" bind:value={exportAuthor} placeholder="Your name or email" />
			</div>

			<div class="gap-2 grid">
				<Label for="export-tags">Tags</Label>
				<Input
					id="export-tags"
					bind:value={exportTags}
					placeholder="facade, option-a, client-approved (comma-separated)"
				/>
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showExportDialog = false)}>Cancel</Button>
			<Button onclick={handleExport}>Save State</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Load Dialog -->
<Dialog.Root bind:open={showLoadDialog}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Load Parameter State</Dialog.Title>
			<Dialog.Description>Select a .sps state file from your drive to load</Dialog.Description>
		</Dialog.Header>

		<div class="py-8">
			<Button onclick={handleLoadClick} class="w-full" size="lg">
				<Upload class="mr-2 h-4 w-4" />
				Select .sps File
			</Button>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showLoadDialog = false)}>Cancel</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Validation Dialog -->
<Dialog.Root bind:open={showValidationDialog}>
	<Dialog.Content class="max-w-2xl max-h-[80vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>State Validation Report</Dialog.Title>
			<Dialog.Description>
				{#if importedState}
					Validating state: {importedState.name}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if validationResult}
			<div class="gap-4 py-4 grid">
				<!-- Summary Alert -->
				{#if validationResult.isValid}
					<Card.Root class="p-4 border-success/30 bg-success/5">
						<div class="gap-3 flex items-start">
							<CheckCircle class="h-5 w-5 text-success" />
							<div>
								<h4 class="text-sm font-semibold text-success-foreground">No Issues Found</h4>
								<p class="text-sm mt-1 text-success-foreground/80">
									This state can be loaded safely.
								</p>
							</div>
						</div>
					</Card.Root>
				{:else if validationResult.canLoad}
					<Card.Root class="p-4 border-warning/30 bg-warning/5">
						<div class="gap-3 flex items-start">
							<AlertTriangle class="h-5 w-5 text-warning" />
							<div>
								<h4 class="text-sm font-semibold text-warning-foreground">Warnings Detected</h4>
								<p class="text-sm mt-1 text-warning-foreground/80">
									{validationResult.issues.length} warning(s) found, but state can still be loaded.
								</p>
							</div>
						</div>
					</Card.Root>
				{:else}
					<Card.Root class="p-4 border-destructive/30 bg-destructive/5">
						<div class="gap-3 flex items-start">
							<AlertTriangle class="h-5 w-5 text-destructive" />
							<div>
								<h4 class="text-sm font-semibold text-destructive">Critical Errors</h4>
								<p class="text-sm mt-1 text-destructive/80">
									Cannot load this state due to critical incompatibilities.
								</p>
							</div>
						</div>
					</Card.Root>
				{/if}

				<!-- Issues List -->
				{#if !validationResult.isValid}
					<div class="space-y-2">
						<h4 class="text-sm font-medium">Issues:</h4>
						{#each validationResult.issues as issue (issue.message)}
							<div
								class="p-3 rounded-lg border {issue.severity === 'error'
									? 'border-destructive/30 bg-destructive/5'
									: 'border-warning/30 bg-warning/5'}"
							>
								<div class="gap-2 flex items-start">
									<AlertTriangle
										class="h-4 w-4 mt-0.5 {issue.severity === 'error'
											? 'text-destructive'
											: 'text-warning'}"
									/>
									<div class="flex-1">
										<p class="text-sm font-medium">{issue.message}</p>
										{#if issue.details}
											<p class="text-xs mt-1 text-muted-foreground">
												Expected: {issue.details.expected} → Actual: {issue.details.actual}
											</p>
										{/if}
									</div>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={cancelImport}>Cancel</Button>
			{#if validationResult?.canLoad}
				<Button onclick={confirmLoad}>Load Anyway</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
