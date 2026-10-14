<script lang="ts">
	import { Download, Upload } from '@lucide/svelte';
	import type { UISchema, ParameterPreset } from '@selvajs/schemas';
	import {
		createSavedState,
		loadPreset,
		type PresetLoadResult,
		exportStateAsJson,
		importStateFromJson
	} from '../../schema/param-exporter';
	import { Button, Input, Label, Textarea, Dialog, Callout, IssueList, toast } from '../primitives';

	import type { ActionButton } from '../../types/actionButton';
	import { DEFAULT_PRESET_LABELS, type PresetLabels } from '../../types/presetLabels';

	interface Props {
		schema: UISchema;
		currentValues: Record<string, unknown>;
		onLoadValues: (values: Record<string, unknown>) => void;
		showSaveButton?: boolean;
		showLoadButton?: boolean;
		actions?: ActionButton[];
		/** When set, persist saved states via this callback instead of downloading a .slvp file. */
		onSaveState?: (state: ParameterPreset) => void | Promise<void>;
		/** When set, the Load dialog lists these states instead of showing a file input. */
		onListStates?: () => ParameterPreset[] | Promise<ParameterPreset[]>;
		/** Overrides merged over `DEFAULT_PRESET_LABELS`. */
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

	let showExportDialog = $state(false);
	let exportName = $state('');
	let exportDescription = $state('');
	let exportAuthor = $state('');
	let exportTags = $state('');

	let showValidationDialog = $state(false);
	let showLoadDialog = $state(false);
	let loadResult = $state<PresetLoadResult | null>(null);
	let loadingPresetName = $state('');
	let fileInputRef = $state<HTMLInputElement | null>(null);

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
			toast.error(t.saveNameRequired);
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

	// Shared by every load path: applies clean presets directly, routes any errors or
	// warnings through the validation dialog.
	function tryLoad(preset: ParameterPreset) {
		const result = loadPreset(preset, schema);
		if (result.isValid) {
			onLoadValues(result.values);
		} else {
			loadResult = result;
			loadingPresetName = preset.name;
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
			toast.error(t.loadImportError + (error as Error).message);
		}

		// Reset so re-picking the same file fires `change` again.
		input.value = '';
	}

	function confirmLoad() {
		if (!loadResult || !loadResult.canLoad) return;

		onLoadValues(loadResult.values);
		showValidationDialog = false;
		loadResult = null;
	}

	function cancelImport() {
		showValidationDialog = false;
		loadResult = null;
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
	<Button variant="outline" size="sm" onclick={openExportDialog}>
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

<!-- .sps is the pre-rename extension; files with it exist on users' drives, so keep accepting it. -->
<input
	bind:this={fileInputRef}
	type="file"
	accept=".slvp,.sps"
	onchange={handleImport}
	class="hidden"
/>

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
			<div class="py-4">
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
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{t.validationTitle}</Dialog.Title>
			<Dialog.Description>
				{#if loadingPresetName}
					{t.validationValidatingPrefix}{loadingPresetName}
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		{#if loadResult}
			<div class="gap-4 py-4 grid">
				{#if loadResult.isValid}
					<Callout tone="success" title={t.validationNoIssuesTitle}>
						{t.validationNoIssuesBody}
					</Callout>
				{:else if loadResult.canLoad}
					<Callout tone="warning" title={t.validationWarningsTitle}>
						{t.validationWarningsBody.replace('{count}', String(loadResult.issues.length))}
					</Callout>
				{:else}
					<Callout tone="danger" title={t.validationErrorsTitle}>
						{t.validationErrorsBody}
					</Callout>
				{/if}

				{#if !loadResult.isValid}
					<div class="gap-2 flex flex-col">
						<h4 class="text-sm font-medium">{t.validationIssuesHeading}</h4>
						<IssueList
							issues={loadResult.issues.map((issue) => ({
								severity: issue.severity === 'error' ? 'error' : 'warning',
								message: issue.message,
								detail: issue.details
									? `${t.validationExpected} ${issue.details.expected} → ${t.validationActual} ${issue.details.actual}`
									: undefined
							}))}
						/>
					</div>
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={cancelImport}>{t.cancelButton}</Button>
			{#if loadResult?.canLoad}
				<Button onclick={confirmLoad}>{t.loadAnywayButton}</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
