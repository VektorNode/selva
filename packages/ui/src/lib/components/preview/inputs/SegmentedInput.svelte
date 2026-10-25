<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes, UISchema } from '@selvajs/schemas';
	import * as ToggleGroup from '$lib/components/primitives/toggle-group';
	import { optionGlyph } from '$lib/schema/option-display';
	import OptionGlyph from './OptionGlyph.svelte';

	interface Props {
		labelId: string;
		value?: string;
		config: DropdownWidgetConfig;
		assets?: UISchema['assets'];
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { labelId, value, config, assets, onChange, disabled = false }: Props = $props();

	const options = $derived(Object.entries(config.options ?? {}));
	const hasIcons = $derived(
		options.some(([name]) => optionGlyph(config.optionMedia?.[name], assets, 'icon'))
	);
</script>

<ToggleGroup.Root
	type="single"
	variant="outline"
	size={hasIcons ? 'stacked' : 'default'}
	class="w-full"
	aria-labelledby={labelId}
	value={value ?? ''}
	onValueChange={(next) => {
		// A single-select group emits '' when the active item is clicked again; keep the selection.
		if (next) onChange(next);
	}}
	{disabled}
>
	{#each options as [name, expr] (name)}
		{@const glyph = optionGlyph(config.optionMedia?.[name], assets, 'icon')}
		<ToggleGroup.Item value={expr ?? name} class="min-w-0 flex-1" title={name}>
			{#if glyph}<OptionGlyph {glyph} />{/if}
			<span class="max-w-full truncate">{name}</span>
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
