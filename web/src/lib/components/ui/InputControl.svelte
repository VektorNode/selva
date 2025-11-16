<script lang="ts">
	import type { InputParameter } from '$lib/types/schema';
	import { debounce } from '$lib/utils/debounce';
	import { Input, Select } from '$lib/components/shared';

	interface Props {
		input: InputParameter;
		value: any;
		displayName?: string;
		onChange: (parameterName: string, value: any) => void;
		debounceMs?: number;
	}

	let { input, value = $bindable(), displayName, onChange, debounceMs = 0 }: Props = $props();

	// Generate unique ID for accessibility
	const inputId = $derived(`input-${input.name}-${Math.random().toString(36).substring(2, 11)}`);

	// Debounced handler for sliders
	const debouncedOnChange = debounce((val: any) => onChange(input.name, val), debounceMs);

	function handleChange(newValue: any) {
		value = newValue;
		if (debounceMs > 0) {
			debouncedOnChange(newValue);
		} else {
			onChange(input.name, newValue);
		}
	}
</script>

<div class="flex flex-col gap-2">
	<label for={inputId} class="flex items-center gap-2 font-medium text-gray-900 text-sm">
		{displayName || input.name}
		{#if input.tooltip}
			<span class="cursor-help text-xs opacity-60" title={input.tooltip}>ℹ️</span>
		{/if}
	</label>

	{#if input.type === 'number'}
		<Input
			type="number"
			bind:value
			min={input.config.min}
			max={input.config.max}
			step={input.config.step ?? 1}
			oninput={(e) => {
				const newValue = parseFloat(e.currentTarget.value);
				if (!isNaN(newValue)) {
					handleChange(newValue);
				}
			}}
		/>
	{:else if input.type === 'slider'}
		<div class="flex items-center gap-4">
			<input
				id={inputId}
				type="range"
				{value}
				min={input.config.min ?? 0}
				max={input.config.max ?? 100}
				step={input.config.step ?? 1}
				class="w-full accent-blue-600"
				oninput={(e) => {
					// Update local value immediately for UI responsiveness
					value = parseFloat(e.currentTarget.value);
					// Debounce the actual update
					handleChange(parseFloat(e.currentTarget.value));
				}}
			/>
			<span class="min-w-[60px] font-mono text-sm text-gray-600">{value}</span>
		</div>
	{:else if input.type === 'checkbox'}
		<label class="flex items-center gap-3 cursor-pointer">
			<input
				id={inputId}
				type="checkbox"
				checked={value}
				class="w-5 h-5 cursor-pointer accent-blue-600"
				onchange={(e) => handleChange(e.currentTarget.checked)}
			/>
			<span class="text-sm text-gray-700">Enabled</span>
		</label>
	{:else if input.type === 'text'}
		<Input
			type="text"
			bind:value
			placeholder={input.config.placeholder}
			oninput={(e) => handleChange(e.currentTarget.value)}
		/>
	{:else if input.type === 'color'}
		<div class="flex items-center gap-4">
			<input
				id={inputId}
				type="color"
				{value}
				class="w-20 h-10 cursor-pointer border border-gray-300 rounded"
				oninput={(e) => handleChange(e.currentTarget.value)}
			/>
			<span class="min-w-[60px] font-mono text-sm text-gray-600">{value}</span>
		</div>
	{:else if input.type === 'dropdown'}
		<Select
			bind:value
			options={(input.config.options || []).map((opt) => ({ value: opt, label: opt }))}
			onchange={(e) => handleChange(e.currentTarget.value)}
		/>
	{/if}

	{#if input.description}
		<p class="text-xs text-gray-600 m-0 italic">
			{input.description}
		</p>
	{/if}
</div>
