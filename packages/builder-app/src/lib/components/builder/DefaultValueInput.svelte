<script lang="ts">
	import type { GrasshopperParamType, DiscoveredInput } from '@selva/shared';
	import { Input, Select, Switch } from '@selva/shared';
	import { validateDefaultValue } from '$lib/utils/validation';

	interface DefaultValueInputProps {
		paramType?: GrasshopperParamType;
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

<div class="flex flex-col gap-1">
	<span class="text-muted-foreground text-[10px] font-medium">Default Value</span>

	{#if paramType === 'number' || paramType === 'integer'}
		<Input
			type="number"
			bind:value
			onkeydown={handleIntegerKeydown}
			oninput={handleNumberInput}
			min={paramConstraints?.minimum}
			max={paramConstraints?.maximum}
			step={paramConstraints?.stepSize || (paramType === 'integer' ? 1 : 0.1)}
			class="bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none {validationError
				? 'border-destructive'
				: 'border-border/70'}"
			placeholder="Enter default value"
		/>
	{:else if paramType === 'boolean'}
		<div class="flex items-center gap-2">
			<Switch
				checked={Boolean(value)}
				onCheckedChange={(checked) => (value = checked)}
				class="scale-75"
			/>
			<span class="text-[10px]">{value ? 'True' : 'False'}</span>
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
			<Select.Trigger class="h-6 text-[10px]">
				{#if value}
					{@const optionEntry = Object.entries(availableOptions).find(([_, val]) => val === value)}
					{optionEntry ? optionEntry[0] : value}
				{:else}
					Select default...
				{/if}
			</Select.Trigger>
			<Select.Content>
				{#each Object.entries(availableOptions) as [key, val]}
					{#if val !== undefined}
						<Select.Item value={val} label={key} />
					{/if}
				{/each}
			</Select.Content>
		</Select.Root>
	{:else}
		<!-- Text, file, or generic types -->
		<Input
			type="text"
			bind:value
			class="bg-background focus:border-primary h-6 rounded border px-2 text-[10px] focus:outline-none {validationError
				? 'border-destructive'
				: 'border-border/70'}"
			placeholder="Enter default value"
		/>
	{/if}

	{#if validationError}
		<span class="text-destructive text-[9px]">{validationError}</span>
	{/if}
</div>
