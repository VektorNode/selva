<script lang="ts">
	import type {
		InputLayoutItem,
		OutputLayoutItem,
		DiscoveredInput,
		NumberWidgetConfig,
		FileInputWidgetConfig,
		TextWidgetConfig,
		DropdownWidgetConfig,
		DynamicValueListOutputConfig,
		ImageWidgetConfig,
		CheckboxWidgetConfig,
		InputSource
	} from '@selvajs/schemas';
	type LayoutItem = InputLayoutItem | OutputLayoutItem;
	import {
		Button,
		Card,
		Collapsible,
		Switch,
		HOST_LABELS,
		hostsFor,
		isGeometryParamType,
		isSupportedOn,
		layoutItemKind
	} from '@selvajs/ui';
	import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, GripVertical } from '@lucide/svelte';
	import { ACCEPTED_FILE_FORMATS } from '@selvajs/schemas';
	import VisibilityRulesEditor from './VisibilityRulesEditor.svelte';
	import OptionMediaEditor from './OptionMediaEditor.svelte';
	import { getBuilderDraft } from './draft-context';
	import ScopeChip from './scope/ScopeChip.svelte';
	import ScopeSection from './scope/ScopeSection.svelte';
	import { SOURCE_KIND_LABELS, type SourceKind } from '$lib/features/builder';
	import { dragHandle } from 'svelte-dnd-action';

	const SOURCE_KINDS = Object.keys(SOURCE_KIND_LABELS) as SourceKind[];

	interface BuilderGroupItemProps {
		item: LayoutItem;
		paramInfo?: DiscoveredInput;
		columns?: number;
		expanded?: boolean;
		onRemove: () => void;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		currentValue?: unknown;
	}

	let {
		item = $bindable(),
		paramInfo,
		columns = 1,
		expanded = $bindable(false),
		onRemove,
		availableInputs,
		getParameterInfo,
		currentValue = undefined
	}: BuilderGroupItemProps = $props();

	// Parses the live Plotly JSON to show the detected chart type for chart outputs.
	const detectedChartType = $derived.by(() => {
		if (item.type !== 'output' || item.widgetType !== 'chart') return null;
		if (!currentValue || typeof currentValue !== 'string') return null;
		try {
			const fig = JSON.parse(currentValue);
			return (fig?.data?.[0]?.type as string) ?? null;
		} catch {
			return null;
		}
	});

	let typeLabel = $derived(paramInfo?.type ?? item.widgetType);
	let isNumberInput = $derived(item.type === 'input' && item.widgetType === 'number');

	// The host picks a geometry input's control from its paramType; the saved widget is a
	// placeholder, so its text options don't apply.
	let isGeometryInput = $derived(item.type === 'input' && isGeometryParamType(paramInfo?.type));
	let elementKind = $derived(
		layoutItemKind(
			item,
			paramInfo
				? [{ id: paramInfo.id, nickname: paramInfo.nickname, paramType: paramInfo.type }]
				: []
		)
	);
	let notOnSelva = $derived(!isSupportedOn('selva', elementKind));
	let runsOnLabel = $derived(
		hostsFor(elementKind)
			.map((host) => HOST_LABELS[host])
			.join(', ')
	);

	let isCheckboxInput = $derived(item.type === 'input' && item.widgetType === 'checkbox');
	let isFileInput = $derived(item.type === 'input' && item.widgetType === 'file');
	let isTextInput = $derived(
		item.type === 'input' && item.widgetType === 'text' && !isGeometryInput
	);
	let isDropdownInput = $derived(item.type === 'input' && item.widgetType === 'dropdown');
	let isFileOutput = $derived(item.type === 'output' && item.widgetType === 'file');
	let isImageOutput = $derived(item.type === 'output' && item.widgetType === 'image');
	let isFileOrImageOutput = $derived(isFileOutput || isImageOutput);
	let isDynamicValueListOutput = $derived(
		item.type === 'output' && item.widgetType === 'dynamicValueList'
	);
	let fileInputConfig = $derived(isFileInput ? (item.config as FileInputWidgetConfig) : null);
	// Scoped to what the parameter accepts (image extensions vs geometry formats), falling back
	// to the geometry default only when discovery declared nothing (e.g. a hand-added file input
	// with no GH source). Formats already selected in the config are unioned in so a manual edit
	// never hides its own value.
	let availableFileFormats = $derived.by<string[]>(() => {
		const declared =
			paramInfo?.acceptedFormats && paramInfo.acceptedFormats.length > 0
				? paramInfo.acceptedFormats
				: Array.from(ACCEPTED_FILE_FORMATS);
		const extras = (fileInputConfig?.acceptedFormats ?? []).filter((f) => !declared.includes(f));
		return [...declared, ...extras];
	});
	let dropdownConfig = $derived(isDropdownInput ? (item.config as DropdownWidgetConfig) : null);
	let imageConfig = $derived(isImageOutput ? (item.config as ImageWidgetConfig) : null);
	let dynamicValueListOutputConfig = $derived(
		isDynamicValueListOutput ? (item.config as DynamicValueListOutputConfig) : null
	);
	let dynamicValueListInputs = $derived(
		availableInputs.filter((p) => p.type === 'dynamicValueList')
	);
	let showAdvanced = $state(false);
	let showVisibilityRules = $state(false);
	let hasVisibilityRules = $derived((item.visibilityCondition?.rules?.length ?? 0) > 0);
	let hasAdvancedOptions = $derived(
		isNumberInput ||
			isCheckboxInput ||
			isFileInput ||
			isTextInput ||
			isDropdownInput ||
			isFileOrImageOutput ||
			isDynamicValueListOutput
	);
	let hasDescription = $derived(!!(item.description && item.description.trim().length > 0));
	let hasCustomConfig = $derived.by(() => {
		if (isNumberInput) {
			const c = item.config as NumberWidgetConfig;
			return c.renderAsSlider === false;
		}
		if (isDropdownInput && dropdownConfig) {
			return (
				(dropdownConfig.displayAs ?? 'dropdown') !== 'dropdown' || !!dropdownConfig.optionMedia
			);
		}
		if (isCheckboxInput) {
			return (item.config as CheckboxWidgetConfig | undefined)?.displayAs === 'button';
		}
		if (isFileInput && fileInputConfig) {
			if (fileInputConfig.defaultInputMode) return true;
			if (fileInputConfig.allowedInputModes && fileInputConfig.allowedInputModes.length < 2)
				return true;
			if (
				fileInputConfig.acceptedFormats &&
				fileInputConfig.acceptedFormats.length < availableFileFormats.length
			)
				return true;
			return false;
		}
		if (isTextInput) {
			const c = item.config as TextWidgetConfig;
			return !!(c.maxLength || c.pattern || c.customErrorMessage);
		}
		if (isImageOutput && imageConfig) {
			if (imageConfig.allowDownload === false) return true;
			if (imageConfig.allowFullscreen === false) return true;
			return true; // image vs file is itself a divergence
		}
		return false;
	});
	let hasNonDefaultConfig = $derived(hasDescription || hasCustomConfig || hasVisibilityRules);

	function setFileOutputMode(mode: 'file' | 'image') {
		if (item.type !== 'output') return;
		if (item.widgetType === mode) return;
		if (mode === 'image') {
			(item as OutputLayoutItem).widgetType = 'image';
			(item as OutputLayoutItem).config = {
				allowDownload: true,
				allowFullscreen: true
			} as ImageWidgetConfig;
		} else {
			(item as OutputLayoutItem).widgetType = 'file';
			(item as OutputLayoutItem).config = {} as never;
		}
	}

	function toggleImageOption(key: 'allowDownload' | 'allowFullscreen') {
		if (!imageConfig) return;
		imageConfig[key] = !(imageConfig[key] ?? true);
	}

	function toggleSliderMode() {
		if (!isNumberInput) return;
		const config = item.config as NumberWidgetConfig;
		config.renderAsSlider = !config.renderAsSlider;
	}

	function toggleButtonMode() {
		if (!isCheckboxInput) return;
		const config = (item.config ?? {}) as CheckboxWidgetConfig;
		config.displayAs = config.displayAs === 'button' ? 'checkbox' : 'button';
		(item as InputLayoutItem).config = config as never;
	}

	const draft = getBuilderDraft();

	const VALUE_LIST_MODES = [
		{ value: 'dropdown', label: 'Dropdown', hint: 'One choice from a menu.' },
		{
			value: 'segmented',
			label: 'Buttons',
			hint: 'One choice from a row of buttons; a list too long for one row shows as a menu.'
		},
		{ value: 'tiles', label: 'Tiles', hint: 'One choice from a grid of thumbnails.' },
		{
			value: 'checklist',
			label: 'Checklist',
			hint: 'Several choices; emits a list to Grasshopper.'
		}
	] as const;

	function setValueListMode(mode: NonNullable<DropdownWidgetConfig['displayAs']>) {
		if (!isDropdownInput) return;
		const config = item.config as DropdownWidgetConfig;
		draft?.edit(() => (config.displayAs = mode === 'dropdown' ? undefined : mode));
	}

	function setFileInputMode(mode: 'upload' | 'url') {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;
		config.defaultInputMode = mode;
	}

	function toggleAllowedMode(mode: 'upload' | 'url') {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;

		// If not set, both modes are allowed by default
		if (!config.allowedInputModes) {
			config.allowedInputModes = ['upload', 'url'];
		}

		const index = config.allowedInputModes.indexOf(mode);
		if (index > -1) {
			if (config.allowedInputModes.length <= 1) return;
			config.allowedInputModes.splice(index, 1);
			if (config.defaultInputMode === mode) {
				config.defaultInputMode = config.allowedInputModes[0];
			}
		} else {
			config.allowedInputModes.push(mode);
		}
	}

	let isInput = $derived(item.type === 'input');

	// Absent source = 'user'. See InputSource in the schema for what 'client'/'server' + key mean.
	let sourceKind = $derived((item as { source?: InputSource }).source?.kind ?? 'user');

	function setSourceKind(kind: SourceKind) {
		if (item.type !== 'input') return;
		const target = item as { source?: InputSource; visible?: boolean };
		if (kind === 'user') {
			target.source = undefined;
			return;
		}
		// Preserve an already-typed key/presentation when switching kind.
		const prevKey = target.source?.key;
		const prevClient = target.source?.client;
		target.source = {
			kind,
			...(prevKey ? { key: prevKey } : {}),
			...(kind === 'client' && prevClient ? { client: prevClient } : {})
		};
		// Externally-supplied inputs default to hidden the first time they leave
		// 'user'; the author can still flip visible back on.
		if (target.visible !== false) target.visible = false;
	}

	let clientPresentation = $derived(
		(item as { source?: InputSource }).source?.client?.presentation ?? 'hidden'
	);

	function setClientPresentation(presentation: 'hidden' | 'slot') {
		if (item.type !== 'input') return;
		const target = item as { source?: InputSource; visible?: boolean };
		if (!target.source || target.source.kind !== 'client') return;
		if (presentation === 'hidden') {
			target.source.client = undefined;
			target.visible = false;
		} else {
			target.source.client = { ...target.source.client, presentation };
			target.visible = true;
		}
	}

	function toggleAcceptedFormat(format: string) {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;
		if (!config.acceptedFormats) {
			// Seed from the parameter's declared set (image vs geometry), not the global default.
			config.acceptedFormats = [...availableFileFormats];
		}

		const index = config.acceptedFormats.indexOf(format);
		if (index > -1) {
			config.acceptedFormats.splice(index, 1);
		} else {
			config.acceptedFormats.push(format);
		}

		if (config.acceptedFormats.length === 0) {
			config.acceptedFormats = [format];
		}
	}
</script>

<div class="relative" data-builder-item-id={item.id}>
	<Collapsible.Root bind:open={expanded}>
		<Card.Root
			class="group bg-background hover:border-border border-border/60 @container overflow-hidden rounded-lg py-1.5 transition-all hover:shadow-sm"
		>
			<!-- Compact header row (always visible). In a card under 20rem the type badge drops its
			     label and the name gives up width first, so the controls stay in view. -->
			<div data-builder-item-header class="flex items-center gap-2 px-3 py-1.5">
				<div
					use:dragHandle
					class="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex cursor-grab rounded-sm p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
					role="button"
					tabindex="0"
					aria-label="Drag to reorder"
				>
					<GripVertical size={16} />
				</div>
				{#if item.type === 'input'}
					<span
						title={typeLabel}
						class="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase"
					>
						<ArrowUpFromLine size={10} strokeWidth={2.5} />
						<span class="@max-[20rem]:sr-only">{typeLabel}</span>
					</span>
				{:else}
					<span
						title={typeLabel}
						class="inline-flex shrink-0 items-center gap-1 rounded-sm bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-orange-600 uppercase dark:text-orange-400"
					>
						<ArrowDownToLine size={10} strokeWidth={2.5} />
						<span class="@max-[20rem]:sr-only">{typeLabel}</span>
					</span>
				{/if}
				<input
					type="text"
					bind:value={item.displayName}
					title={paramInfo ? `GH: ${paramInfo.nickname}` : undefined}
					class="hover:border-border focus:border-primary min-w-16 rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium focus:outline-none @[20rem]:min-w-28"
					style="field-sizing: content; max-width: 18rem;"
					placeholder="Display Name"
				/>
				{#if notOnSelva}
					<ScopeChip
						scope="local"
						label="Not on Selva yet"
						title={runsOnLabel
							? `Shows in ${runsOnLabel} only. On Selva it is left out, and the definition uses its own value.`
							: 'This plugin does not know this element. It is kept in the schema, but no host shows it.'}
					/>
				{/if}
				{#if isInput && sourceKind !== 'user'}
					<ScopeChip
						scope="compute"
						label={SOURCE_KIND_LABELS[sourceKind]}
						title="Value source: {SOURCE_KIND_LABELS[sourceKind]}"
					/>
				{/if}
				{#if detectedChartType}
					<span
						class="text-muted-foreground/70 border-border/60 rounded-sm border px-1.5 py-0.5 text-[10px] capitalize @max-[20rem]:hidden"
					>
						{detectedChartType}
					</span>
				{/if}
				<Collapsible.Trigger
					class="hover:bg-accent/50 relative ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-sm {hasNonDefaultConfig
						? 'text-primary'
						: 'text-muted-foreground hover:text-foreground'}"
					aria-label={expanded ? 'Collapse details' : 'Expand details'}
					title={hasNonDefaultConfig ? 'Has custom configuration' : undefined}
				>
					<ChevronDown size={16} class={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
				</Collapsible.Trigger>
				<Button
					variant="ghost"
					size="icon-sm"
					class="hover:bg-destructive hover:text-destructive-foreground h-6 w-6 text-base"
					onclick={onRemove}>×</Button
				>
			</div>

			<Collapsible.Content>
				<div class="flex flex-col gap-2 px-2 pt-1 pb-2">
					{#if columns > 1}
						<label class="text-muted-foreground flex items-center gap-1 text-[10px]">
							Span:
							<input
								type="number"
								bind:value={() => item.span ?? 1, (span) => (item.span = span ?? undefined)}
								min="1"
								max={columns}
								class="border-border bg-background text-foreground w-8 rounded-sm border px-1 py-0.5 text-[10px]"
							/>
						</label>
					{/if}

					<!-- Description -->
					<input
						type="text"
						bind:value={item.description}
						class="text-muted-foreground hover:border-border focus:border-primary rounded-sm border border-transparent bg-transparent px-1
							   py-0.5 text-[11px] focus:outline-none"
						placeholder="Description"
					/>

					<!-- Advanced -->
					{#if hasAdvancedOptions}
						<div class="border-border/70 mt-1 border-t pt-1">
							<button
								onclick={() => (showAdvanced = !showAdvanced)}
								class="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-1 text-[11px]"
							>
								<ChevronDown
									size={12}
									class={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
								/>
								Advanced
							</button>

							{#if showAdvanced}
								<!-- Output: File ↔ Image display mode switcher -->
								{#if isFileOrImageOutput}
									<div class="flex flex-col gap-2 pb-2">
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium">Display As</span>
											<div class="grid grid-cols-2 gap-1">
												<button
													onclick={() => setFileOutputMode('file')}
													class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
														isFileOutput
															? 'bg-primary text-primary-foreground border-primary'
															: 'border-border/70 hover:border-border hover:bg-accent'
													}`}
												>
													File (download)
												</button>
												<button
													onclick={() => setFileOutputMode('image')}
													class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
														isImageOutput
															? 'bg-primary text-primary-foreground border-primary'
															: 'border-border/70 hover:border-border hover:bg-accent'
													}`}
												>
													Image viewer
												</button>
											</div>
											<span class="text-muted-foreground/70 text-[9px]">
												{isImageOutput
													? 'Renders PNG/JPG/WEBP/GIF/SVG inline. Other formats fall back to download.'
													: 'Standard download button for any file type.'}
											</span>
										</div>

										{#if isImageOutput && imageConfig}
											<div class="flex items-center justify-between text-[11px]">
												<span class="text-muted-foreground">Allow download</span>
												<Switch
													checked={imageConfig.allowDownload ?? true}
													onCheckedChange={() => toggleImageOption('allowDownload')}
													class="scale-75"
												/>
											</div>
											<div class="flex items-center justify-between text-[11px]">
												<span class="text-muted-foreground">Allow fullscreen</span>
												<Switch
													checked={imageConfig.allowFullscreen ?? true}
													onCheckedChange={() => toggleImageOption('allowFullscreen')}
													class="scale-75"
												/>
											</div>
										{/if}
									</div>
								{/if}

								<!-- Output: Dynamic Value List target-input picker -->
								{#if isDynamicValueListOutput && dynamicValueListOutputConfig}
									<div class="flex flex-col gap-1 pb-2">
										<span class="text-muted-foreground text-[10px] font-medium">Target Input</span>
										{#if dynamicValueListInputs.length === 0}
											<span class="text-[10px] text-amber-600 dark:text-amber-400">
												No Dynamic Value List inputs in this schema. Add one first, then pick it
												here.
											</span>
										{:else}
											<select
												bind:value={dynamicValueListOutputConfig.targetInputId}
												class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-2 text-[10px] focus:outline-none"
											>
												<option value="">— Select an input —</option>
												{#each dynamicValueListInputs as input (input.id)}
													<option value={input.id}>{input.nickname}</option>
												{/each}
											</select>
											<span class="text-muted-foreground/70 text-[9px]">
												The Dynamic Value List input that this output's computed options populate.
											</span>
										{/if}
									</div>
								{/if}

								<!-- Widget-Specific Options -->
								{#if isNumberInput}
									{@const config = item.config as NumberWidgetConfig}
									<div class="mt-1 flex items-center justify-between text-[11px]">
										<span class="text-muted-foreground">Slider</span>
										<Switch
											checked={config.renderAsSlider ?? true}
											onCheckedChange={toggleSliderMode}
											class="scale-75"
										/>
									</div>
								{/if}

								{#if isCheckboxInput}
									<div class="flex items-center justify-between text-[11px]">
										<div class="flex flex-col">
											<span class="text-muted-foreground">Button</span>
											<span class="text-muted-foreground/70 text-[9px]">
												A press solves once with true, then goes back to false. Rhino only.
											</span>
										</div>
										<Switch
											checked={(item.config as CheckboxWidgetConfig | undefined)?.displayAs ===
												'button'}
											onCheckedChange={toggleButtonMode}
											class="scale-75"
										/>
									</div>
								{/if}

								{#if isDropdownInput && dropdownConfig}
									{@const mode = dropdownConfig.displayAs ?? 'dropdown'}
									<div class="flex flex-col gap-2 pb-2">
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium">Display As</span>
											<div class="grid grid-cols-4 gap-1">
												{#each VALUE_LIST_MODES as option (option.value)}
													<button
														onclick={() => setValueListMode(option.value)}
														class={`rounded-sm border px-1 py-1 text-[10px] transition-colors ${
															mode === option.value
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														{option.label}
													</button>
												{/each}
											</div>
											<span class="text-muted-foreground/70 text-[9px]">
												{VALUE_LIST_MODES.find((m) => m.value === mode)?.hint}
											</span>
										</div>
										<OptionMediaEditor config={dropdownConfig} />
									</div>
								{/if}

								{#if isFileInput && fileInputConfig}
									<div class="flex flex-col gap-2">
										<!-- Allowed Input Modes -->
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium"
												>Allowed Input Modes</span
											>
											<div class="grid grid-cols-2 gap-1">
												{#each ['upload', 'url'] as const as mode (mode)}
													{@const isAllowed =
														fileInputConfig.allowedInputModes?.includes(mode) ?? true}
													<button
														onclick={() => toggleAllowedMode(mode)}
														class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
															isAllowed
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														{mode === 'upload' ? 'Upload' : 'URL'}
													</button>
												{/each}
											</div>
											<span class="text-muted-foreground text-[9px]"
												>At least one must be enabled</span
											>
										</div>

										<!-- Default Mode (only relevant when both are allowed) -->
										{#if (fileInputConfig.allowedInputModes?.length ?? 2) > 1}
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-[10px] font-medium"
													>Default Mode</span
												>
												<div class="grid grid-cols-2 gap-1">
													<button
														onclick={() => setFileInputMode('upload')}
														class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
															(fileInputConfig.defaultInputMode ?? 'upload') === 'upload'
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														Upload
													</button>
													<button
														onclick={() => setFileInputMode('url')}
														class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
															fileInputConfig.defaultInputMode === 'url'
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														URL
													</button>
												</div>
											</div>
										{/if}

										<!-- File Formats -->
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium">File Formats</span
											>
											<div class="grid max-h-24 grid-cols-3 gap-1 overflow-y-auto">
												{#each availableFileFormats as format (format)}
													{@const isChecked = fileInputConfig.acceptedFormats?.includes(format)}
													<button
														onclick={() => toggleAcceptedFormat(format)}
														class={`rounded-sm border px-1.5 py-0.5 text-[9px] whitespace-nowrap transition-colors ${
															isChecked
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														{format}
													</button>
												{/each}
											</div>
										</div>
									</div>
								{/if}

								{#if isTextInput}
									{@const config = item.config as TextWidgetConfig}
									<div class="flex flex-col gap-2">
										<!-- Max Length -->
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium">Max Length</span>
											<input
												type="number"
												min="1"
												bind:value={config.maxLength}
												placeholder="No limit"
												class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-2 text-[10px] focus:outline-none"
											/>
										</div>

										<!-- Pattern (Regex) -->
										<div class="flex flex-col gap-1">
											<span class="text-muted-foreground text-[10px] font-medium"
												>Validation Pattern (Regex)</span
											>
											<input
												type="text"
												bind:value={config.pattern}
												placeholder="e.g., ^[a-zA-Z0-9]+$"
												class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-2 font-mono text-[10px] focus:outline-none"
											/>
										</div>

										<!-- Custom Error Message -->
										{#if config.pattern}
											<div class="flex flex-col gap-1">
												<span class="text-muted-foreground text-[10px] font-medium"
													>Custom Error Message</span
												>
												<input
													type="text"
													bind:value={config.customErrorMessage}
													placeholder="Invalid format"
													class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-2 text-[10px] focus:outline-none"
												/>
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Visibility Rules Section (separate from Advanced) -->
					<div class="border-border/70 mt-1 border-t pt-1">
						<button
							onclick={() => (showVisibilityRules = !showVisibilityRules)}
							class="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-1 text-[11px]"
						>
							<ChevronDown
								size={12}
								class={`transition-transform ${showVisibilityRules ? 'rotate-180' : ''}`}
							/>
							Visibility Rules {hasVisibilityRules
								? `(${item.visibilityCondition?.rules?.length ?? 0})`
								: ''}
						</button>

						{#if showVisibilityRules}
							<VisibilityRulesEditor
								bind:visibilityCondition={item.visibilityCondition}
								{availableInputs}
								currentParamInfo={paramInfo}
								{getParameterInfo}
								isGroupCondition={item.type === 'output'}
								options={item.type === 'input' && item.widgetType === 'dropdown'
									? item.config.options
									: undefined}
							/>
						{/if}
					</div>

					<!-- Value source (input items only): who supplies this input. -->
					{#if isInput}
						<ScopeSection scope="compute">
							<div class="flex flex-col gap-1">
								<span class="text-muted-foreground text-[10px] font-medium">Value source</span>
								<div class="grid grid-cols-3 gap-1">
									{#each SOURCE_KINDS as kind (kind)}
										<button
											type="button"
											aria-pressed={sourceKind === kind}
											onclick={() => setSourceKind(kind)}
											class={`rounded-sm border px-2 py-1 text-[10px] transition-colors ${
												sourceKind === kind
													? 'bg-primary text-primary-foreground border-primary'
													: 'border-border/70 bg-background hover:border-border hover:bg-accent'
											}`}
										>
											{SOURCE_KIND_LABELS[kind]}
										</button>
									{/each}
								</div>
							</div>

							{#if sourceKind !== 'user'}
								{@const source = (item as { source?: InputSource }).source}
								<div class="flex flex-col gap-1">
									<input
										type="text"
										aria-label="Source key"
										value={source?.key ?? ''}
										oninput={(e) => {
											const t = item as { source?: InputSource };
											if (t.source) t.source.key = e.currentTarget.value || undefined;
										}}
										placeholder={sourceKind === 'client'
											? 'e.g. line-app'
											: 'e.g. capture.geometry'}
										class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-2 font-mono text-[10px] focus:outline-none"
									/>
									<span class="text-muted-foreground text-[10px]">
										{#if sourceKind === 'client'}
											Filled by a browser app before the form runs. The key names which producer to
											open. Hidden from the form by default.
										{:else}
											Looked up on the server at solve time. The key names what to fetch. Never
											shown in the form.
										{/if}
									</span>

									{#if sourceKind === 'client'}
										<div class="flex items-center justify-between gap-2">
											<span class="text-muted-foreground">In the form</span>
											<select
												value={clientPresentation}
												onchange={(e) =>
													setClientPresentation(e.currentTarget.value as 'hidden' | 'slot')}
												class="border-border/70 bg-background focus:border-primary h-6 rounded-sm border px-1.5 text-[10px] focus:outline-none"
											>
												<option value="hidden">Hidden</option>
												<option value="slot">Custom slot (host app)</option>
											</select>
										</div>
										{#if clientPresentation === 'slot'}
											<span class="text-muted-foreground text-[10px]">
												The host app renders its own element here; Selva renders nothing itself.
											</span>
										{/if}
									{/if}
								</div>
							{/if}
						</ScopeSection>
					{/if}
				</div>
			</Collapsible.Content>
		</Card.Root>
	</Collapsible.Root>
</div>
