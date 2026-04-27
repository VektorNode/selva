<script lang="ts">
	import type {
		InputLayoutItem,
		OutputLayoutItem,
		DiscoveredInput,
		NumberWidgetConfig,
		FileInputWidgetConfig,
		TextWidgetConfig
	} from '@selvajs/schemas';
	type LayoutItem = InputLayoutItem | OutputLayoutItem;
	import { Badge, Button, Card, Switch } from '@selvajs/ui';
	import { ArrowDownToLine, ArrowUpFromLine, ChevronDown, GripVertical } from '@lucide/svelte';
	import { ACCEPTED_FILE_FORMATS } from '$lib/features/builder/widget-config';
	import VisibilityRulesEditor from './VisibilityRulesEditor.svelte';

	interface BuilderGroupItemProps {
		item: LayoutItem;
		paramInfo?: DiscoveredInput;
		columns?: number;
		onRemove: () => void;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		currentValue?: unknown;
	}

	let {
		item = $bindable(),
		paramInfo,
		columns = 1,
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

	let isNumberInput = $derived(item.type === 'input' && item.widgetType === 'number');
	let isFileInput = $derived(item.type === 'input' && item.widgetType === 'file');
	let isTextInput = $derived(item.type === 'input' && item.widgetType === 'text');
	let fileInputConfig = $derived(isFileInput ? (item.config as FileInputWidgetConfig) : null);
	let showAdvanced = $state(false);
	let showVisibilityRules = $state(false);
	let hasVisibilityRules = $derived((item.visibilityCondition?.rules?.length ?? 0) > 0);
	// Advanced section only for widget-specific options
	let hasAdvancedOptions = $derived(isNumberInput || isFileInput || isTextInput);

	function toggleSliderMode() {
		if (!isNumberInput) return;
		const config = item.config as NumberWidgetConfig;
		config.renderAsSlider = !config.renderAsSlider;
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
	<Card.Root
		class="hover:border-primary py-1 transition-all hover:shadow-sm
			{item.type === 'input' ? 'bg-inputparam' : 'bg-outputparam'}"
	>
		<div class="grid grid-cols-[auto_20px_1fr] gap-2 p-2">
			<!-- Drag Handle (visual affordance only — dndzone handles drag initiation) -->
			<div
				class="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex cursor-grab self-start rounded p-0.5 active:cursor-grabbing"
				role="button"
				tabindex="0"
				aria-label="Drag to reorder"
			>
				<GripVertical size={14} />
			</div>
			<div class="flex items-start pt-0.5">
				{#if item.type === 'input'}
					<ArrowUpFromLine size={14} class="text-muted-foreground" />
				{:else}
					<ArrowDownToLine size={14} class="text-muted-foreground" />
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<!-- Display Name + Span + Remove -->
				<div class="flex items-center gap-2">
					<input
						type="text"
						bind:value={item.displayName}
						class="hover:border-border focus:border-primary flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5
							   text-xs font-medium focus:outline-none"
						placeholder="Display Name"
					/>
					{#if columns > 1}
						<label class="text-muted-foreground flex shrink-0 items-center gap-1 text-[10px]">
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
					<Button
						variant="ghost"
						size="icon-sm"
						class="hover:bg-destructive hover:text-destructive-foreground h-4 w-4"
						onclick={onRemove}>×</Button
					>
				</div>

				<!-- Description -->
				<input
					type="text"
					bind:value={item.description}
					class="text-muted-foreground hover:border-border focus:border-primary rounded-sm border border-transparent bg-transparent px-1
						   py-0.5 text-[11px] focus:outline-none"
					placeholder="Description"
				/>

				<!-- Parameter Info / Type Badge -->
				{#if paramInfo}
					<div class="flex items-center gap-2">
						<Badge variant="default" class="rounded-xs px-1 py-0 text-[9px]">
							{paramInfo.type}
						</Badge>
						<span class="text-muted-foreground font-mono text-[9px]">
							GH: {paramInfo.nickname}
						</span>
					</div>
				{:else if item.type === 'output'}
					<div class="flex items-center gap-2">
						<Badge variant="default" class="rounded-xs px-1 py-0 text-[9px]">
							{item.widgetType}
						</Badge>
						{#if detectedChartType}
							<Badge variant="outline" class="rounded-xs px-1 py-0 text-[9px] capitalize">
								{detectedChartType}
							</Badge>
						{/if}
					</div>
				{/if}

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
											<span class="text-muted-foreground text-[10px] font-medium">Default Mode</span
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
										<span class="text-muted-foreground text-[10px] font-medium">File Formats</span>
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
		</div>
	</Card.Root>
</div>
