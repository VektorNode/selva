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
	import { DEFAULT_PRESET_LABELS, type PresetLabels } from '../../types/presetLabels';

	interface Props {
		schema: UISchema;
		currentValues: Record<string, unknown>;
		onLoadValues: (values: Record<string, unknown>) => void;
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		actions?: ActionButton[];
		/** When set, persist saved states via this callback instead of downloading a .sps file. */
		onSaveState?: (state: ParameterPreset) => void | Promise<void>;
		/** When set, the Load dialog lists these states instead of showing a file input. */
		onListStates?: () => ParameterPreset[] | Promise<ParameterPreset[]>;
		/** Partial overrides for UI strings (e.g. for localization). */
		labels?: Partial<PresetLabels>;
	}

	let {
		schema,
		currentValues,
		onLoadValues,
		showSaveButton = true,
		showLoadButton = true,
		actions = [],
		onSaveState,
		onListStates,
		labels
	}: Props = $props();

	const t = $derived({ ...DEFAULT_PRESET_LABELS, ...labels });

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

	// Listed states (when onListStates is provided)
	let listedStates = $state<ParameterPreset[]>([]);
	let isLoadingList = $state(false);
	let listError = $state('');

	function openExportDialog() {
		exportName = `State ${new Date().toLocaleDateString()}`;
		exportDescription = '';
		exportAuthor = schema.author || '';
		exportTags = '';
		showExportDialog = true;
	}

	async function handleExport() {
		if (!exportName.trim()) {
			alert(t.saveNameRequired);
			return;
		}

		const state = createSavedState(schema, currentValues, {
			name: exportName.trim(),
			description: exportDescription.trim() || undefined,
			author: exportAuthor.trim() || undefined,
			tags: exportTags
				.split(',')
				.map((tag) => tag.trim())
				.filter((tag) => tag.length > 0)
		});

		if (onSaveState) await onSaveState(state);
		else exportStateAsJson(state);
		showExportDialog = false;
	}

	// Validate a preset, then either load it directly (no issues) or open the
	// validation dialog (any errors or warnings). Shared by every load path.
	function tryLoad(preset: ParameterPreset) {
		const validation = validateSavedState(preset, schema);
		if (validation.isValid) {
			onLoadValues(extractLoadableValues(preset, schema, validation));
		} else {
			importedState = preset;
			validationResult = validation;
			showValidationDialog = true;
		}
	}

	async function handleImport(event: Event) {
		const input = event.target as HTMLInputElement;
		if (!input.files || input.files.length === 0) return;

		try {
			const imported = await importStateFromJson(input.files[0]);
			tryLoad(imported);
		} catch (error) {
			alert(t.loadImportError + (error as Error).message);
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

	async function openLoadDialog() {
		showLoadDialog = true;
		if (!onListStates) return;

		isLoadingList = true;
		listError = '';
		listedStates = [];
		try {
			listedStates = await onListStates();
		} catch (error) {
			listError = (error as Error).message;
		} finally {
			isLoadingList = false;
		}
	}

	function handleLoadClick() {
		fileInputRef?.click();
		showLoadDialog = false;
	}

	function selectListedState(preset: ParameterPreset) {
		tryLoad(preset);
		showLoadDialog = false;
	}
</script>

{#if showSaveButton}
	<Button variant="default" size="sm" onclick={openExportDialog}>
		<Download class="mr-2 h-4 w-4" />
		{t.saveButton}
	</Button>
{/if}

{#if showLoadButton}
	<Button variant="outline" size="sm" onclick={openLoadDialog}>
		<Upload class="mr-2 h-4 w-4" />
		{t.loadButton}
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
			<Dialog.Title>{t.saveDialogTitle}</Dialog.Title>
			<Dialog.Description>{t.saveDialogDescription}</Dialog.Description>
		</Dialog.Header>

		<div class="gap-4 py-4 grid">
			<div class="gap-2 grid">
				<Label for="export-name">{t.saveNameLabel}</Label>
				<Input id="export-name" bind:value={exportName} placeholder={t.saveNamePlaceholder} />
			</div>

			<div class="gap-2 grid">
				<Label for="export-description">{t.saveDescriptionLabel}</Label>
				<Textarea
					id="export-description"
					bind:value={exportDescription}
					placeholder={t.saveDescriptionPlaceholder}
					rows={3}
				/>
			</div>

			<div class="gap-2 grid">
				<Label for="export-author">{t.saveAuthorLabel}</Label>
				<Input id="export-author" bind:value={exportAuthor} placeholder={t.saveAuthorPlaceholder} />
			</div>

			<div class="gap-2 grid">
				<Label for="export-tags">{t.saveTagsLabel}</Label>
				<Input id="export-tags" bind:value={exportTags} placeholder={t.saveTagsPlaceholder} />
			</div>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showExportDialog = false)}>{t.cancelButton}</Button>
			<Button onclick={handleExport}>{t.saveButton}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Load Dialog -->
<Dialog.Root bind:open={showLoadDialog}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>{t.loadDialogTitle}</Dialog.Title>
			<Dialog.Description>{t.loadDialogDescription}</Dialog.Description>
		</Dialog.Header>

		{#if onListStates}
			<div class="py-4 max-h-[60vh] overflow-y-auto">
				{#if isLoadingList}
					<p class="text-sm py-8 text-center text-muted-foreground">…</p>
				{:else if listError}
					<p class="text-sm py-8 text-center text-destructive">{listError}</p>
				{:else if listedStates.length === 0}
					<p class="text-sm py-8 text-center text-muted-foreground">{t.loadEmptyList}</p>
				{:else}
					<div class="space-y-2">
						{#each listedStates as preset (preset.id)}
							<button
								type="button"
								onclick={() => selectListedState(preset)}
								class="p-3 w-full rounded-lg border text-left transition-colors hover:bg-muted"
							>
								<div class="text-sm font-medium">{preset.name}</div>
								{#if preset.description}
									<div class="text-xs mt-0.5 text-muted-foreground">{preset.description}</div>
								{/if}
								<div class="text-xs mt-1 text-muted-foreground">
									{new Date(preset.timestamp).toLocaleString()}
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="py-8">
				<Button onclick={handleLoadClick} class="w-full" size="lg">
					<Upload class="mr-2 h-4 w-4" />
					{t.loadFromFileButton}
				</Button>
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (showLoadDialog = false)}>{t.cancelButton}</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Validation Dialog -->
<Dialog.Root bind:open={showValidationDialog}>
	<Dialog.Content class="max-w-2xl max-h-[80vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>{t.validationTitle}</Dialog.Title>
			<Dialog.Description>
				{#if importedState}
					{t.validationValidatingPrefix}{importedState.name}
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
								<h4 class="text-sm font-semibold text-success-foreground">
									{t.validationNoIssuesTitle}
								</h4>
								<p class="text-sm mt-1 text-success-foreground/80">
									{t.validationNoIssuesBody}
								</p>
							</div>
						</div>
					</Card.Root>
				{:else if validationResult.canLoad}
					<Card.Root class="p-4 border-warning/30 bg-warning/5">
						<div class="gap-3 flex items-start">
							<AlertTriangle class="h-5 w-5 text-warning" />
							<div>
								<h4 class="text-sm font-semibold text-warning-foreground">
									{t.validationWarningsTitle}
								</h4>
								<p class="text-sm mt-1 text-warning-foreground/80">
									{t.validationWarningsBody.replace(
										'{count}',
										String(validationResult.issues.length)
									)}
								</p>
							</div>
						</div>
					</Card.Root>
				{:else}
					<Card.Root class="p-4 border-destructive/30 bg-destructive/5">
						<div class="gap-3 flex items-start">
							<AlertTriangle class="h-5 w-5 text-destructive" />
							<div>
								<h4 class="text-sm font-semibold text-destructive">{t.validationErrorsTitle}</h4>
								<p class="text-sm mt-1 text-destructive/80">
									{t.validationErrorsBody}
								</p>
							</div>
						</div>
					</Card.Root>
				{/if}

				<!-- Issues List -->
				{#if !validationResult.isValid}
					<div class="space-y-2">
						<h4 class="text-sm font-medium">{t.validationIssuesHeading}</h4>
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
												{t.validationExpected}
												{issue.details.expected} → {t.validationActual}
												{issue.details.actual}
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
			<Button variant="outline" onclick={cancelImport}>{t.cancelButton}</Button>
			{#if validationResult?.canLoad}
				<Button onclick={confirmLoad}>{t.loadAnywayButton}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
