<script lang="ts">
	import type { BooleanInputType, DataTreeDefault } from 'rhino-compute-core/grasshopper';
	import type { Snippet } from 'svelte';
	import BaseParam from './BaseParam.svelte';
	import { getThemeContext } from '../../theme/theme-context.svelte.js';

	type Props = {
		input: BooleanInputType;
		value: boolean | boolean[] | DataTreeDefault<boolean>;
		showLabel?: boolean;
		customInput?: Snippet<
			[{ value: boolean; onUpdate: (val: boolean) => void; input: BooleanInputType; index: number }]
		>;
	};

	let { input, value = $bindable(), showLabel = false, customInput }: Props = $props();

	const themeContext = getThemeContext();
	const theme = $derived(themeContext.getTheme());
</script>

<BaseParam bind:value name={input.name}>
	{#snippet children({ entry, onUpdate })}
		{#if customInput}
			{@render customInput({ value: entry.value, onUpdate, input, index: entry.index })}
		{:else}
			<label class="flex cursor-pointer items-center gap-2">
				<input
					type="checkbox"
					checked={entry.value}
					onchange={(e) => onUpdate(e.currentTarget.checked)}
					class="checkbox-input"
					style="accent-color: {theme.colors?.primary ?? '#3b82f6'}"
				/>
				{#if showLabel}
					<span class="checkbox-label" style="color: {theme.colors?.text ?? '#0f172a'}">
						{input.name}
						{entry.index > 0 ? entry.index + 1 : ''}
					</span>
				{/if}
			</label>
		{/if}
	{/snippet}
</BaseParam>

<style>
	.checkbox-input {
		width: 1rem;
		height: 1rem;
		border-radius: 0.25rem;
		cursor: pointer;
		transition: all 200ms ease-in-out;
	}

	.checkbox-input:focus {
		outline: none;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--rh-color-primary, #3b82f6) 20%, transparent);
	}

	.checkbox-label {
		font-size: 0.875rem;
		user-select: none;
	}
</style>
