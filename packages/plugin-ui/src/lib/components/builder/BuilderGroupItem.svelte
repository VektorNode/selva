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
		InputSource
	} from '@selvajs/schemas';
	type LayoutItem = InputLayoutItem | OutputLayoutItem;
	import { Button, Card, Collapsible, Switch } from '@selvajs/ui';
	import {
		ArrowDownToLine,
		ArrowUpFromLine,
		ChevronDown,
		GripVertical,
		AlertTriangle
	} from '@lucide/svelte';
	import { ACCEPTED_FILE_FORMATS } from '@selvajs/schemas';
	import VisibilityRulesEditor from './VisibilityRulesEditor.svelte';
	import { dragHandle } from 'svelte-dnd-action';

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

	// For chart outputs: parse the live Plotly JSON to show the detected chart type
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

	// Estimated step count of the underlying GH slider. Above ~1000 steps the
	// browser slider widget becomes noticeably laggy on drag (each tick fires a
	// re-render and a debounced WS round-trip).
	const SLIDER_STEPS_WARNING_THRESHOLD = 3000;
	const sliderStepCount = $derived.by(() => {
		if (!isNumberInput || !paramInfo) return 0;
		const min = paramInfo.minimum;
		const max = paramInfo.maximum;
		const step = paramInfo.stepSize;
		if (
			typeof min !== 'number' ||
			typeof max !== 'number' ||
			typeof step !== 'number' ||
			step <= 0 ||
			!Number.isFinite(max - min)
		) {
			return 0;
		}
		return Math.floor((max - min) / step);
	});
	const sliderTooManySteps = $derived(sliderStepCount > SLIDER_STEPS_WARNING_THRESHOLD);
	const showSliderPerfWarning = $derived.by(() => {
		if (!isNumberInput || !sliderTooManySteps) return false;
		const cfg = item.config as NumberWidgetConfig | undefined;
		return cfg?.renderAsSlider ?? true;
	});
	let isFileInput = $derived(item.type === 'input' && item.widgetType === 'file');
	let isTextInput = $derived(item.type === 'input' && item.widgetType === 'text');
	let isDropdownInput = $derived(item.type === 'input' && item.widgetType === 'dropdown');
	let isFileOutput = $derived(item.type === 'output' && item.widgetType === 'file');
	let isImageOutput = $derived(item.type === 'output' && item.widgetType === 'image');
	let isFileOrImageOutput = $derived(isFileOutput || isImageOutput);
	let isDynamicValueListOutput = $derived(
		item.type === 'output' && item.widgetType === 'dynamicValueList'
	);
	let fileInputConfig = $derived(isFileInput ? (item.config as FileInputWidgetConfig) : null);
	let dropdownConfig = $derived(isDropdownInput ? (item.config as DropdownWidgetConfig) : null);
	let imageConfig = $derived(isImageOutput ? (item.config as ImageWidgetConfig) : null);
	let dynamicValueListOutputConfig = $derived(
		isDynamicValueListOutput ? (item.config as DynamicValueListOutputConfig) : null
	);
	// Dynamic value list inputs this output can target.
	let dynamicValueListInputs = $derived(
		availableInputs.filter((p) => p.type === 'dynamicValueList')
	);
	let showAdvanced = $state(false);
	let showVisibilityRules = $state(false);
	let hasVisibilityRules = $derived((item.visibilityCondition?.rules?.length ?? 0) > 0);
	// Advanced section only for widget-specific options
	let hasAdvancedOptions = $derived(
		isNumberInput ||
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
			return dropdownConfig.displayAs === 'checklist';
		}
		if (isFileInput && fileInputConfig) {
			if (fileInputConfig.defaultInputMode) return true;
			if (fileInputConfig.allowedInputModes && fileInputConfig.allowedInputModes.length < 2)
				return true;
			if (
				fileInputConfig.acceptedFormats &&
				fileInputConfig.acceptedFormats.length < ACCEPTED_FILE_FORMATS.length
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

	function toggleChecklistMode() {
		if (!isDropdownInput) return;
		const config = item.config as DropdownWidgetConfig;
		config.displayAs = config.displayAs === 'checklist' ? 'dropdown' : 'checklist';
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
			// Don't allow removing the last mode
			if (config.allowedInputModes.length <= 1) return;
			config.allowedInputModes.splice(index, 1);
			// If we just removed the default mode, update defaultInputMode
			if (config.defaultInputMode === mode) {
				config.defaultInputMode = config.allowedInputModes[0];
			}
		} else {
			config.allowedInputModes.push(mode);
		}
	}

	let isInput = $derived(item.type === 'input');

	// Where this input's value comes from (InputSource.kind). Absent source = 'user'.
	//   user   → the person fills it in the form (normal control).
	//   client → an app in the browser fills it before the form runs; `key` names
	//            which producer (e.g. 'line-app') so the host pre-routes to it.
	//   server → resolved server-side at solve time from host data; `key` names
	//            what to fetch (e.g. 'capture.geometry') for the IBindingResolver.
	// One opaque `key` either way; `kind` says how the host reads it.
	let sourceKind = $derived((item as { source?: InputSource }).source?.kind ?? 'user');

	function setSourceKind(kind: 'user' | 'client' | 'server') {
		if (item.type !== 'input') return;
		const target = item as { source?: InputSource; visible?: boolean };
		if (kind === 'user') {
			target.source = undefined;
			return;
		}
		// Preserve any already-typed key and client presentation when switching.
		const prevKey = target.source?.key;
		const prevClient = target.source?.client;
		target.source = {
			kind,
			...(prevKey ? { key: prevKey } : {}),
			...(kind === 'client' && prevClient ? { client: prevClient } : {})
		};
		// Externally-supplied inputs are typically hidden from the end user.
		// Default to hidden the first time it leaves 'user'; author can override.
		if (target.visible !== false) target.visible = false;
	}

	// Client presentation: 'hidden' (default) or 'slot' (host renders a custom
	// element in the input's place). 'slot' requires the cell to be visible.
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

	function setSlotLabel(label: string) {
		if (item.type !== 'input') return;
		const target = item as { source?: InputSource };
		if (!target.source?.client) return;
		target.source.client.slotLabel = label || undefined;
	}

	function toggleAcceptedFormat(format: string) {
		if (!isFileInput) return;
		const config = item.config as FileInputWidgetConfig;
		if (!config) return;
		if (!config.acceptedFormats) {
			config.acceptedFormats = Array.from(ACCEPTED_FILE_FORMATS);
		}

		const index = config.acceptedFormats.indexOf(format);
		if (index > -1) {
			config.acceptedFormats.splice(index, 1);
		} else {
			config.acceptedFormats.push(format);
		}

		// Ensure at least one format is selected
		if (config.acceptedFormats.length === 0) {
			config.acceptedFormats = [format];
		}
	}
</script>

<div class="relative">
	<Collapsible.Root bind:open={expanded}>
		<Card.Root
			class="group bg-background hover:border-border border-border/60 overflow-hidden py-1.5 transition-all hover:shadow-sm"
		>
			<!-- Compact header row (always visible) -->
			<div class="flex items-center gap-2 px-3 py-1.5">
				<div
					use:dragHandle
					class="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex cursor-grab rounded p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
					role="button"
					tabindex="0"
					aria-label="Drag to reorder"
				>
					<GripVertical size={16} />
				</div>
				{#if item.type === 'input'}
					<span
						class="bg-primary/10 text-primary inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide uppercase"
					>
						<ArrowUpFromLine size={10} strokeWidth={2.5} />
						{typeLabel}
					</span>
				{:else}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-sm bg-orange-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-orange-600 uppercase dark:text-orange-400"
					>
						<ArrowDownToLine size={10} strokeWidth={2.5} />
						{typeLabel}
					</span>
				{/if}
				{#if showSliderPerfWarning}
					<span
						class="inline-flex shrink-0 items-center gap-1 rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400"
						title={`Slider has ~${sliderStepCount.toLocaleString()} steps (> ${SLIDER_STEPS_WARNING_THRESHOLD.toLocaleString()}). May slow the UI on drag. Increase the step size in Grasshopper or turn off Slider mode.`}
					>
						<AlertTriangle size={10} strokeWidth={2.5} />
						{sliderStepCount.toLocaleString()} steps
					</span>
				{/if}
				<input
					type="text"
					bind:value={item.displayName}
					title={paramInfo ? `GH: ${paramInfo.nickname}` : undefined}
					class="hover:border-border focus:border-primary min-w-0 rounded-sm border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium focus:outline-none"
					style="field-sizing: content; min-width: 7rem; max-width: 18rem;"
					placeholder="Display Name"
				/>
				{#if detectedChartType}
					<span
						class="text-muted-foreground/70 border-border/60 rounded-sm border px-1.5 py-0.5 text-[10px] capitalize"
					>
						{detectedChartType}
					</span>
				{/if}
				<Collapsible.Trigger
					class="hover:bg-accent/50 relative ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded {hasNonDefaultConfig
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
								bind:value={item.span}
								min="1"
								max={columns}
								class="border-border bg-background text-foreground w-8 rounded border px-1 py-0.5 text-[10px]"
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
													class={`rounded border px-2 py-1 text-[10px] transition-colors ${
														isFileOutput
															? 'bg-primary text-primary-foreground border-primary'
															: 'border-border/70 hover:border-border hover:bg-accent'
													}`}
												>
													File (download)
												</button>
												<button
													onclick={() => setFileOutputMode('image')}
													class={`rounded border px-2 py-1 text-[10px] transition-colors ${
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
												class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none"
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
									{#if showSliderPerfWarning}
										<div
											class="mt-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] text-amber-900"
										>
											This slider has ~{sliderStepCount.toLocaleString()} steps. Sliders above
											{SLIDER_STEPS_WARNING_THRESHOLD.toLocaleString()} steps can noticeably slow the
											UI on drag. Consider increasing the step size in Grasshopper or switching to a number
											input.
										</div>
									{/if}
								{/if}

								{#if isDropdownInput && dropdownConfig}
									<div class="flex flex-col gap-2">
										<div class="flex items-center justify-between text-[11px]">
											<div class="flex flex-col">
												<span class="text-muted-foreground">Multi-select (checklist)</span>
												<span class="text-muted-foreground/70 text-[9px]">
													Renders as checkboxes; emits a list to Grasshopper.
												</span>
											</div>
											<Switch
												checked={dropdownConfig.displayAs === 'checklist'}
												onCheckedChange={toggleChecklistMode}
												class="scale-75"
											/>
										</div>
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
														class={`rounded border px-2 py-1 text-[10px] transition-colors ${
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
														class={`rounded border px-2 py-1 text-[10px] transition-colors ${
															(fileInputConfig.defaultInputMode ?? 'upload') === 'upload'
																? 'bg-primary text-primary-foreground border-primary'
																: 'border-border/70 hover:border-border hover:bg-accent'
														}`}
													>
														Upload
													</button>
													<button
														onclick={() => setFileInputMode('url')}
														class={`rounded border px-2 py-1 text-[10px] transition-colors ${
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
												{#each ACCEPTED_FILE_FORMATS as format (format)}
													{@const isChecked = fileInputConfig.acceptedFormats?.includes(format)}
													<button
														onclick={() => toggleAcceptedFormat(format)}
														class={`rounded border px-1.5 py-0.5 text-[9px] whitespace-nowrap transition-colors ${
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
												class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none"
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
												class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 font-mono text-[10px] focus:outline-none"
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
													class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none"
												/>
											</div>
										{/if}
									</div>
								{/if}
							{/if}
						</div>
					{/if}

					<!-- Value source (input items only): who supplies this input. -->
					{#if isInput}
						<div class="border-border/70 mt-1 flex flex-col gap-1 border-t pt-2 text-[11px]">
							<div class="flex items-center justify-between gap-2">
								<span class="text-muted-foreground">Value source</span>
								<select
									value={sourceKind}
									onchange={(e) =>
										setSourceKind(e.currentTarget.value as 'user' | 'client' | 'server')}
									class="border-border/70 bg-background focus:border-primary h-6 rounded border px-1.5 text-[10px] focus:outline-none"
								>
									<option value="user">User (form)</option>
									<option value="client">Client (browser app)</option>
									<option value="server">Server (looked up)</option>
								</select>
							</div>

							{#if sourceKind !== 'user'}
								{@const source = (item as { source?: InputSource }).source}
								<div class="flex flex-col gap-1">
									<input
										type="text"
										value={source?.key ?? ''}
										oninput={(e) => {
											const t = item as { source?: InputSource };
											if (t.source) t.source.key = e.currentTarget.value || undefined;
										}}
										placeholder={sourceKind === 'client'
											? 'e.g. line-app'
											: 'e.g. capture.geometry'}
										class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 font-mono text-[10px] focus:outline-none"
									/>
									<span class="text-muted-foreground/70 text-[9px]">
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
												class="border-border/70 bg-background focus:border-primary h-6 rounded border px-1.5 text-[10px] focus:outline-none"
											>
												<option value="hidden">Hidden</option>
												<option value="slot">Custom slot (host app)</option>
											</select>
										</div>
										{#if clientPresentation === 'slot'}
											{@const client = (item as { source?: InputSource }).source?.client}
											<input
												type="text"
												value={client?.slotLabel ?? ''}
												oninput={(e) => setSlotLabel(e.currentTarget.value)}
												placeholder="Slot label (optional, e.g. Edit JSON)"
												class="border-border/70 bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none"
											/>
											<span class="text-muted-foreground/70 text-[9px]">
												The host app renders its own element here. The label is passed through
												untouched; Selva renders nothing itself.
											</span>
										{/if}
									{/if}
								</div>
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
				</div>
			</Collapsible.Content>
		</Card.Root>
	</Collapsible.Root>
</div>
