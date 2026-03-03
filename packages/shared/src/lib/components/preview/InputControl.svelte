<script lang="ts">
	import type {
		InputLayoutItem,
		NumberWidgetConfig,
		TextWidgetConfig,
		DropdownWidgetConfig,
		FileInputWidgetConfig,
		SupportedTypes
	} from '$lib/types/generated';
	import {
		isNumberWidget,
		isTextWidget,
		isDropdownWidget,
		isCheckboxWidget,
		isFileWidget
	} from '$lib/types/generated';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { HelpCircle } from '@lucide/svelte';
	import FileInput from '$lib/components/preview/FileInput.svelte';

	interface Props {
		item: InputLayoutItem;
		value?: unknown;
		displayName?: string;
		onChange: (paramId: string, value: SupportedTypes) => void;
		environment?: 'local' | 'compute';
		disabled?: boolean;
	}

	let {
		item,
		value = $bindable(),
		displayName,
		onChange,
		environment: _environment = undefined,
		disabled = false
	}: Props = $props();

	const inputId = $derived(`input-${item.paramId}-${Math.random().toString(36).substring(2, 11)}`);

	let validationError = $state<string | null>(null);

	function handleChange(newValue: SupportedTypes) {
		value = newValue;
		onChange(item.paramId, newValue);
	}

	function validateNumberInput(value: number, config: NumberWidgetConfig): string | null {
		// Range validation
		if (config.minimum !== undefined && value < config.minimum) {
			return `Minimum value is ${config.minimum}`;
		}
		if (config.maximum !== undefined && value > config.maximum) {
			return `Maximum value is ${config.maximum}`;
		}

		return null;
	}

	function validateTextInput(value: string, config: TextWidgetConfig): string | null {
		// Max length validation
		if (config.maxLength && value.length > config.maxLength) {
			return `Maximum ${config.maxLength} characters allowed`;
		}

		// Pattern validation
		if (config.pattern) {
			try {
				const regex = new RegExp(config.pattern);
				if (!regex.test(value)) {
					return config.customErrorMessage || 'Invalid format';
				}
			} catch {
				console.error('Invalid regex pattern:', config.pattern);
				return 'Invalid validation pattern configured';
			}
		}

		return null;
	}

	// Debounced change for number inputs - waits for user to stop typing
	// 400ms delay: user types "1000", we wait 400ms after last keystroke before sending
	const debouncedOnChange = debounce((paramId: string, newValue: SupportedTypes) => {
		onChange(paramId, newValue);
	}, 400);

	// Slider uses debounce: waits for user to pause/stop dragging before sending
	// This prevents overwhelming the server during rapid slider movement
	// 150ms = responsive enough to feel immediate, but batches rapid changes
	const debouncedSliderChange = debounce((paramId: string, newValue: SupportedTypes) => {
		onChange(paramId, newValue);
	}, 150);

	function handleNumberInputChange(newValue: number, config: NumberWidgetConfig) {
		value = newValue;
		const error = validateNumberInput(newValue, config);
		validationError = error;

		// Only send to Grasshopper if validation passes
		if (!error) {
			debouncedOnChange(item.paramId, newValue);
		}
	}

	function handleSliderChange(newValue: number) {
		value = newValue; // Update UI immediately for smooth visual feedback
		debouncedSliderChange(item.paramId, newValue);
	}

	function getOptimalStepSize(min: number, max: number, requestedStep: number): number {
		const _range = max - min;
		//TODO: FIX THIS
		// If more than 1000 steps, adjust step size to keep it under 1000
		// const totalSteps = _range / requestedStep;
		// if (totalSteps > 1000) {
		// 	console.warn(
		// 		`Adjusting step size from ${requestedStep} to ${_range / 1000} for parameter ${item.paramId} to limit total steps to 1000.`
		// 	);
		// 	return _range / 1000;
		// }

		return requestedStep;
	}
</script>

<div class="gap-2 flex flex-col">
	<div class="gap-2 flex items-center">
		<Label for={inputId}>
			{displayName || item.displayName || item.paramId}
		</Label>
		{#if item.description}
			<Dialog.Root>
				<Dialog.Trigger class="cursor-help opacity-60 transition-opacity hover:opacity-100">
					<button class="p-1">
						<HelpCircle size={16} />
					</button>
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title>{displayName || item.displayName || item.paramId}</Dialog.Title>
						<Dialog.Description>
							{item.description}
						</Dialog.Description>
					</Dialog.Header>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	</div>

	{#if isNumberWidget(item)}
		{@const config = item.config as NumberWidgetConfig}
		{#if config.renderAsSlider}
			{@const minVal = config.minimum ?? 0}
			{@const maxVal = config.maximum ?? 100}
			{@const requestedStep = config.stepSize ?? 1}
			{@const optimalStep = getOptimalStepSize(minVal, maxVal, requestedStep)}
			<div class="gap-4 flex items-center">
				<Slider
					type="single"
					value={typeof value === 'number' ? value : minVal}
					min={minVal}
					max={maxVal}
					step={optimalStep}
					class="flex-1"
					onValueChange={handleSliderChange}
					{disabled}
				/>
				<span class="min-w-12 text-sm text-right text-muted-foreground">
					{typeof value === 'number'
						? value.toFixed(Math.max(0, -Math.floor(Math.log10(requestedStep))))
						: minVal}
				</span>
			</div>
		{:else}
			<div class="space-y-1">
				<Input
					id={inputId}
					type="number"
					bind:value
					min={config.minimum}
					max={config.maximum}
					step={config.stepSize ?? 1}
					placeholder={config.placeholder}
					class={validationError ? 'border-destructive' : ''}
					{disabled}
					oninput={() => {
						validationError = null; // Clear error while typing
					}}
					onchange={(e: any) => {
						const target = e.currentTarget as HTMLInputElement;
						const newValue = parseFloat(target.value);
						if (!isNaN(newValue)) {
							handleNumberInputChange(newValue, config);
						}
					}}
					onblur={(e: any) => {
						const target = e.currentTarget as HTMLInputElement;
						const newValue = parseFloat(target.value);
						if (!isNaN(newValue)) {
							const error = validateNumberInput(newValue, config);
							validationError = error;
							if (!error) {
								handleChange(newValue);
							}
						}
					}}
				/>
				{#if validationError}
					<p class="text-xs text-destructive">{validationError}</p>
				{/if}
			</div>
		{/if}
	{:else if isCheckboxWidget(item)}
		<div class="gap-3 flex items-center">
			<Checkbox
				id={inputId}
				checked={typeof value === 'boolean' ? value : false}
				onCheckedChange={(checked: boolean) => handleChange(checked === true)}
				{disabled}
			/>
			<Label for={inputId} class="text-sm cursor-pointer text-muted-foreground">Enabled</Label>
		</div>
	{:else if isTextWidget(item)}
		{@const config = item.config as TextWidgetConfig}
		<div class="space-y-1">
			<Input
				id={inputId}
				type="text"
				bind:value
				placeholder={config.placeholder}
				maxlength={config.maxLength}
				class={validationError ? 'border-destructive' : ''}
				{disabled}
				oninput={() => {
					validationError = null; // Clear error while typing
					// Don't send to Grasshopper on every keystroke - wait for blur
				}}
				onblur={(e: Event) => {
					const target = e.currentTarget as HTMLInputElement;
					const error = validateTextInput(target.value, config);
					validationError = error;

					// Only send to Grasshopper if validation passes
					if (!error) {
						handleChange(target.value);
					}
				}}
			/>
			{#if validationError}
				<p class="text-xs text-destructive">{validationError}</p>
			{/if}
		</div>
	{:else if isDropdownWidget(item)}
		{@const config = item.config as DropdownWidgetConfig}
		{@const options = config.options || {}}
		{@const currentValue = typeof value === 'string' ? value : ''}
		{@const currentLabel =
			Object.entries(options).find(([_, val]) => val === currentValue)?.[0] || currentValue}
		<Select.Root
			type="single"
			value={currentValue}
			onValueChange={(selected: string) => {
				if (selected) {
					handleChange(selected);
				}
			}}
			{disabled}
		>
			<Select.Trigger class="w-full" {disabled}>
				{currentLabel || 'Select an option...'}
			</Select.Trigger>
			<Select.Content>
				{#each Object.entries(options) as [name, val] (val)}
					<Select.Item value={val || ''} label={name} />
				{/each}
			</Select.Content>
		</Select.Root>
	{:else if isFileWidget(item)}
		{@const config = item.config as FileInputWidgetConfig}
		{@const fileValue = typeof value === 'string' ? value : ''}
		<FileInput
			value={fileValue}
			acceptedFormats={config?.acceptedFormats ?? []}
			onChange={(newValue) => handleChange(newValue)}
			defaultInputMode={config?.defaultInputMode}
			allowedInputModes={config?.allowedInputModes}
		/>
	{/if}
</div>
