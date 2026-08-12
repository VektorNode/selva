<script lang="ts">
	import type { ParamType, DiscoveredInput } from '@selvajs/schemas';
	import { Input, Select, Switch } from '@selvajs/ui';
	import { validateDefaultValue } from '$lib/utils/validation';

	interface DefaultValueInputProps {
		paramType?: ParamType;
		paramConstraints?: DiscoveredInput;
		value: unknown;
		options?: Record<string, string | undefined>;
	}

	let {
		paramType,
		paramConstraints,
		value = $bindable(),
		options
	}: DefaultValueInputProps = $props();

	let validationError = $derived(validateDefaultValue(value, paramConstraints));

	function handleIntegerKeydown(e: KeyboardEvent) {
		if (paramType === 'integer' && (e.key === '.' || e.key === ',')) {
			e.preventDefault();
		}
	}

	function handleNumberInput(e: Event & { currentTarget: HTMLInputElement }) {
		if (e.currentTarget.value === '') {
			value = undefined;
			return;
		}
		const num = parseFloat(e.currentTarget.value);
		if (!isNaN(num)) {
			value = num;
		}
	}
</script>

<div class="flex flex-col gap-1.5">
	{#if paramType === 'number' || paramType === 'integer'}
		<Input
			type="number"
			bind:value
			onkeydown={handleIntegerKeydown}
			oninput={handleNumberInput}
			min={paramConstraints?.minimum}
			max={paramConstraints?.maximum}
			step={paramConstraints?.stepSize || (paramType === 'integer' ? 1 : 0.1)}
			class="h-9"
			placeholder="Enter default value"
		/>
	{:else if paramType === 'boolean'}
		<div class="flex items-center gap-2">
			<Switch checked={Boolean(value)} onCheckedChange={(checked) => (value = checked)} />
			<span class="text-sm">{value ? 'True' : 'False'}</span>
		</div>
	{:else if paramType === 'valueList' && (options || paramConstraints?.options)}
		{@const availableOptions = options || paramConstraints?.options || {}}
		<Select.Root
			type="single"
			value={String(value || '')}
			onValueChange={(newValue) => {
				if (newValue) value = newValue;
			}}
		>
			<Select.Trigger class="h-9 text-sm">
				{#if value}
					{@const optionEntry = Object.entries(availableOptions).find(([_, val]) => val === value)}
					{optionEntry ? optionEntry[0] : value}
				{:else}
					Select default...
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each Object.entries(availableOptions) as [key, val] ([key, val])}
					{#if val !== undefined}
						<Select.Item value={val} label={key} />
					{/if}
				{/each}
			</Select.Content>
		</Select.Root>
	{:else}
		<!-- Text, file, or generic types -->
		<Input type="text" bind:value class="h-9" placeholder="Enter default value" />
	{/if}

	{#if validationError}
		<span class="text-destructive text-[9px]">{validationError}</span>
	{/if}
</div>
