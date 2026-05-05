<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes } from '@selvajs/schemas';
	import { Checkbox } from '$lib/components/primitives/checkbox';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		inputId: string;
		value?: string[];
		config?: DropdownWidgetConfig;
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { inputId, value, config, onChange, disabled = false }: Props = $props();

	const options = $derived(config?.options ?? {});
	const selected = $derived(new Set(value ?? []));

	function toggle(expr: string, checked: boolean) {
		const next = new SvelteSet(selected);
		if (checked) {
			next.add(expr);
		} else {
			next.delete(expr);
		}
		onChange([...next]);
	}
</script>

<div class="divide-y divide-border/60 overflow-hidden rounded-md border border-input">
	{#each Object.entries(options) as [name, expr] (expr ?? name)}
		{@const optionValue = expr ?? name}
		{@const optionId = `${inputId}-${optionValue}`}
		{@const isSelected = selected.has(optionValue)}
		<label
			for={optionId}
			class="gap-3 px-3 py-2 text-sm flex items-center transition-colors select-none hover:bg-accent/50 {isSelected
				? 'bg-accent/30'
				: ''} {disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}"
		>
			<Checkbox
				id={optionId}
				checked={isSelected}
				onCheckedChange={(state) => toggle(optionValue, state === true)}
				{disabled}
			/>
			<span class="flex-1" class:font-medium={isSelected}>{name}</span>
		</label>
	{/each}
</div>
