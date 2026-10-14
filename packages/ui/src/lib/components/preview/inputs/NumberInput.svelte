<script lang="ts">
	import type { NumberWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import { debounce } from '$lib/utils/debounce';
	import { Input } from '$lib/components/primitives/input';
	import { Slider } from '$lib/components/primitives/slider';
	import * as InputGroup from '$lib/components/primitives/input-group';
	import { Separator } from '$lib/components/primitives/separator';
	import * as Field from '$lib/components/primitives/field';

	interface Props {
		inputId: string;
		value?: number;
		config?: NumberWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value = $bindable(), config, onChange, disabled = false }: Props = $props();

	let validationError = $state<string | null>(null);

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

	const decimals = $derived(Math.max(0, -Math.floor(Math.log10(step))));

	function commitTypedValue(input: HTMLInputElement) {
		const parsed = parseFloat(input.value);
		if (isNaN(parsed)) {
			input.value = numValue.toFixed(decimals);
			return;
		}
		const clamped = Math.min(max, Math.max(min, parsed));
		input.value = clamped.toFixed(decimals);
		if (clamped === value) return;
		value = clamped;
		onChange(clamped);
	}
</script>

{#if config?.renderAsSlider}
	<!-- Value and track share one box, the height of a number input, so mixed rows line up and
	     a value can't be read as belonging to the neighbouring slider. -->
	<InputGroup.Root>
		<InputGroup.Input
			id={inputId}
			type="number"
			class="w-18 flex-none"
			value={numValue.toFixed(decimals)}
			{min}
			{max}
			{step}
			{disabled}
			onchange={(e) => commitTypedValue(e.currentTarget)}
			onkeydown={(e) => {
				if (e.key === 'Enter') e.currentTarget.blur();
			}}
		/>
		<Separator orientation="vertical" />
		<div class="px-3.5 min-w-0 flex flex-1 items-center">
			<Slider
				type="single"
				value={numValue}
				{min}
				{max}
				{step}
				onValueChange={handleSliderChange}
				{disabled}
			/>
		</div>
	</InputGroup.Root>
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
