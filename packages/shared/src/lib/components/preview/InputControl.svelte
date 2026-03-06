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
	import * as Field from '$lib/components/ui/field';
	import * as Select from '$lib/components/ui/select';
	import * as Dialog from '$lib/components/ui/dialog';
	import { HelpCircle } from '@lucide/svelte';
	import FileInput from '$lib/components/preview/FileInput.svelte';

	interface Props {
		item: InputLayoutItem;
		value?: SupportedTypes;
		displayName?: string;
		onChange: (paramId: string, value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let {
		item,
		value = $bindable(undefined),
		displayName,
		onChange,
		disabled = false
	}: Props = $props();

	// Stable ID — not reactive, computed once at component creation
	const inputId = $derived(`input-${item.paramId}`);
	const label = $derived(displayName || item.displayName || item.paramId);

	let validationError = $state<string | null>(null);

	// Immediately commits a value (used on blur / checkbox / dropdown)
	function commit(newValue: SupportedTypes) {
		value = newValue;
		onChange(item.paramId, newValue);
	}

	// Debounced variants — used during active typing/dragging
	const commitDebounced = debounce(
		(newValue: SupportedTypes) => onChange(item.paramId, newValue),
		400
	);
	const commitSliderDebounced = debounce(
		(newValue: SupportedTypes) => onChange(item.paramId, newValue),
		150
	);

	function validateNumber(val: number, config: NumberWidgetConfig): string | null {
		if (config.minimum !== undefined && val < config.minimum)
			return `Minimum value is ${config.minimum}`;
		if (config.maximum !== undefined && val > config.maximum)
			return `Maximum value is ${config.maximum}`;
		return null;
	}

	function validateText(val: string, config: TextWidgetConfig): string | null {
		if (config.maxLength && val.length > config.maxLength)
			return `Maximum ${config.maxLength} characters allowed`;
		if (config.pattern) {
			try {
				if (!new RegExp(config.pattern).test(val))
					return config.customErrorMessage || 'Invalid format';
			} catch {
				return 'Invalid validation pattern configured';
			}
		}
		return null;
	}

	function handleNumberInput(newValue: number, config: NumberWidgetConfig) {
		const error = validateNumber(newValue, config);
		validationError = error;
		if (!error) {
			value = newValue; // only propagate through binding when valid
			commitDebounced(newValue);
		}
	}

	function handleSliderChange(newValue: number) {
		value = newValue;
		commitSliderDebounced(newValue);
	}

	let sliderEditing = $state(false);
	let sliderInputValue = $state('');

	function focusSliderInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function decimalPlaces(step: number): number {
		return Math.max(0, -Math.floor(Math.log10(step)));
	}
</script>

<Field.Field>
	<Field.Label for={inputId} class="gap-2 flex items-center">
		{label}
		{#if item.description}
			<Dialog.Root>
				<Dialog.Trigger class="p-1 cursor-help opacity-60 transition-opacity hover:opacity-100">
					<HelpCircle size={16} />
				</Dialog.Trigger>
				<Dialog.Content class="sm:max-w-md">
					<Dialog.Header>
						<Dialog.Title>{label}</Dialog.Title>
						<Dialog.Description>{item.description}</Dialog.Description>
					</Dialog.Header>
				</Dialog.Content>
			</Dialog.Root>
		{/if}
	</Field.Label>

	{#if isNumberWidget(item)}
		{@const config = item.config as NumberWidgetConfig}
		{@const min = config.minimum ?? 0}
		{@const max = config.maximum ?? 100}
		{@const step = config.stepSize ?? 1}
		{@const numValue = typeof value === 'number' ? value : min}

		{#if config.renderAsSlider}
			{@const dp = decimalPlaces(step)}
			<div class="gap-4 flex items-center">
				<Slider
					type="single"
					value={numValue}
					{min}
					{max}
					{step}
					class="flex-1"
					onValueChange={handleSliderChange}
					{disabled}
				/>
				{#if sliderEditing}
					<input
						use:focusSliderInput
						type="number"
						{step}
						class="min-w-12 w-16 text-sm border-b border-border bg-transparent text-right outline-none focus:border-foreground"
						bind:value={sliderInputValue}
						onblur={() => {
							const parsed = parseFloat(sliderInputValue);
							if (!isNaN(parsed)) handleSliderChange(Math.min(max, Math.max(min, parsed)));
							sliderEditing = false;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								const parsed = parseFloat(sliderInputValue);
								if (!isNaN(parsed)) handleSliderChange(Math.min(max, Math.max(min, parsed)));
								sliderEditing = false;
							} else if (e.key === 'Escape') {
								sliderEditing = false;
							}
						}}
					/>
				{:else}
					<span
						role="button"
						tabindex="0"
						class="min-w-12 text-sm cursor-text text-right text-muted-foreground select-none"
						title="Double-click to edit"
						ondblclick={() => {
							sliderInputValue = numValue.toFixed(dp);
							sliderEditing = true;
						}}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								sliderInputValue = numValue.toFixed(dp);
								sliderEditing = true;
							}
						}}
					>
						{numValue.toFixed(dp)}
					</span>
				{/if}
			</div>
		{:else}
			<Input
				id={inputId}
				type="number"
				value={numValue}
				min={config.minimum}
				max={config.maximum}
				{step}
				placeholder={config.placeholder}
				data-invalid={validationError ? true : undefined}
				aria-invalid={validationError ? true : undefined}
				class={validationError ? 'border-destructive' : ''}
				{disabled}
				oninput={() => (validationError = null)}
				onchange={(e) => {
					const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
					if (!isNaN(newValue)) handleNumberInput(newValue, config);
				}}
				onblur={(e) => {
					const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
					if (!isNaN(newValue)) {
						const error = validateNumber(newValue, config);
						validationError = error;
						if (!error) commit(newValue);
					}
				}}
			/>
		{/if}
		{#if validationError}
			<Field.Error>{validationError}</Field.Error>
		{/if}
	{:else if isCheckboxWidget(item)}
		<Field.Field orientation="horizontal">
			<Checkbox
				id={inputId}
				checked={typeof value === 'boolean' ? value : false}
				onCheckedChange={(checked) => commit(checked === true)}
				{disabled}
			/>
			<Field.Label for={inputId} class="font-normal cursor-pointer text-muted-foreground">
				Enabled
			</Field.Label>
		</Field.Field>
	{:else if isTextWidget(item)}
		{@const config = item.config as TextWidgetConfig}
		<Input
			id={inputId}
			type="text"
			bind:value
			placeholder={config.placeholder}
			maxlength={config.maxLength}
			data-invalid={validationError ? true : undefined}
			aria-invalid={validationError ? true : undefined}
			class={validationError ? 'border-destructive' : ''}
			{disabled}
			oninput={() => (validationError = null)}
			onblur={(e) => {
				const val = (e.currentTarget as HTMLInputElement).value;
				const error = validateText(val, config);
				validationError = error;
				if (!error) commit(val);
			}}
		/>
		{#if validationError}
			<Field.Error>{validationError}</Field.Error>
		{/if}
	{:else if isDropdownWidget(item)}
		{@const config = item.config as DropdownWidgetConfig}
		{@const options = config.options || {}}
		{@const currentValue = typeof value === 'string' ? value : ''}
		{@const currentLabel =
			Object.entries(options).find(([_, v]) => v === currentValue)?.[0] ?? currentValue}
		<Select.Root
			type="single"
			value={currentValue}
			onValueChange={(selected) => {
				if (selected) commit(selected);
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
		<FileInput
			value={typeof value === 'string' ? value : ''}
			acceptedFormats={config?.acceptedFormats ?? []}
			onChange={(newValue) => commit(newValue)}
			defaultInputMode={config?.defaultInputMode}
			allowedInputModes={config?.allowedInputModes}
		/>
	{/if}
</Field.Field>
