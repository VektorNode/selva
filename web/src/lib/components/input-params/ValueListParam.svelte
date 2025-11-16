<script lang="ts">
	import type { DataTreeDefault, ValueListInputType } from 'rhino-compute-core/grasshopper';
	import type { Snippet } from 'svelte';
	import BaseParam from './BaseParam.svelte';
	import ThemedInput from '../ThemedInput.svelte';
	import type { InputVariant, ComponentSize } from '../../theme/types.js';

	type Props = {
		input: ValueListInputType;
		value: string | string[] | DataTreeDefault<string>;
		variant?: InputVariant;
		size?: ComponentSize;
		customInput?: Snippet<
			[{ value: string; onUpdate: (val: string) => void; input: ValueListInputType }]
		>;
	};

	let { input, value = $bindable(), variant, size, customInput }: Props = $props();

	// Convert values object to array of options for easier iteration
	const options = $derived(
		Object.entries(input.values).map(([label, val]) => ({
			label,
			value: val
		}))
	);
</script>

<BaseParam bind:value name={input.name}>
	{#snippet children({ entry, onUpdate })}
		{#if customInput}
			{@render customInput({ value: entry.value, onUpdate, input })}
		{:else}
			<ThemedInput {variant} {size}>
				<select value={entry.value} onchange={(e) => onUpdate(e.currentTarget.value)}>
					{#each options as option (option.value)}
						<option value={option.value} selected={option.value === entry.value}>
							{option.label}
						</option>
					{/each}
				</select>
			</ThemedInput>
		{/if}
	{/snippet}
</BaseParam>
