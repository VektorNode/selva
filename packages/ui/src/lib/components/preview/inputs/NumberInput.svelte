<script lang="ts">
	import type { NumberWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/ui/input';
	import { Slider } from '$lib/components/ui/slider';
	import * as Field from '$lib/components/ui/field';

	interface Props {
		inputId: string;
		value?: number;
		config?: NumberWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), config, onChange, disabled = false }: Props = $props();

	let validationError = $state<string | null>(null);
	let sliderEditing = $state(false);
	let sliderInputValue = $state('');

	const min = $derived(config?.minimum ?? 0);
	const max = $derived(config?.maximum ?? 100);
	const step = $derived(config?.stepSize ?? 1);
	const numValue = $derived(typeof value === 'number' ? value : min);

	const commitDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 400);
	const commitSliderDebounced = debounce((newValue: SupportedTypes) => onChange(newValue), 150);

	function validateNumber(val: number): string | null {
		if (config?.minimum !== undefined && val < config.minimum)
			return `Minimum value is ${config.minimum}`;
		if (config?.maximum !== undefined && val > config.maximum)
			return `Maximum value is ${config.maximum}`;
		return null;
	}

	function handleNumberInput(newValue: number) {
		const error = validateNumber(newValue);
		validationError = error;
		if (!error) {
			value = newValue;
			commitDebounced(newValue);
		}
	}

	function handleSliderChange(newValue: number) {
		value = newValue;
		commitSliderDebounced(newValue);
	}

	function focusSliderInput(node: HTMLInputElement) {
		node.focus();
		node.select();
	}

	function decimalPlaces(stepSize: number): number {
		return Math.max(0, -Math.floor(Math.log10(stepSize)));
	}
</script>

{#if config?.renderAsSlider}
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
				tabindex={0}
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
		min={config?.minimum}
		max={config?.maximum}
		{step}
		placeholder={config?.placeholder}
		data-invalid={validationError ? true : undefined}
		aria-invalid={validationError ? true : undefined}
		class={validationError ? 'border-destructive' : ''}
		{disabled}
		oninput={() => (validationError = null)}
		onchange={(e) => {
			const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
			if (!isNaN(newValue)) handleNumberInput(newValue);
		}}
		onblur={(e) => {
			const newValue = parseFloat((e.currentTarget as HTMLInputElement).value);
			if (!isNaN(newValue)) {
				const error = validateNumber(newValue);
				validationError = error;
				if (!error) {
					value = newValue;
					onChange(newValue);
				}
			}
		}}
	/>
{/if}

{#if validationError}
	<Field.Error>{validationError}</Field.Error>
{/if}
