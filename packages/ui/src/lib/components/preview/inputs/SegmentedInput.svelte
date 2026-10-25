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
</script>

<ToggleGroup.Root
	type="single"
	variant="outline"
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
			<span class="gap-1.5 min-w-0 flex items-center">
				{#if glyph}<OptionGlyph {glyph} />{/if}
				<span class="truncate">{name}</span>
			</span>
		</ToggleGroup.Item>
	{/each}
</ToggleGroup.Root>
