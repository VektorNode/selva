<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes, UISchema } from '@selvajs/schemas';
	import * as Select from '$lib/components/primitives/select';
	import { optionGlyph } from '$lib/schema/option-display';
	import OptionGlyph from './OptionGlyph.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	interface Props {
		value?: string;
		config?: DropdownWidgetConfig;
		assets?: UISchema['assets'];
		onChange: (value: SupportedTypes) => void;
		disabled?: boolean;
	}

	let { value, config, assets, onChange, disabled = false }: Props = $props();

	const locale = getLocaleContext();

	const options = $derived(config?.options || {});
	const currentValue = $derived(value || '');
	const currentLabel = $derived(
		Object.entries(options).find(([_, expr]) => expr === currentValue)?.[0] ?? currentValue
	);
	const glyphOf = (name: string) => optionGlyph(config?.optionMedia?.[name], assets);
	const currentGlyph = $derived(glyphOf(currentLabel));
</script>

<Select.Root
	type="single"
	value={currentValue}
	onValueChange={(selected) => {
		if (selected) {
			value = selected;
			onChange(selected);
		}
	}}
	{disabled}
>
	<Select.Trigger class="w-full" {disabled}>
		<span class="gap-2 min-w-0 flex items-center">
			{#if currentGlyph}<OptionGlyph glyph={currentGlyph} />{/if}
			<span class="truncate">{currentLabel || locale.messages.selectOption}</span>
		</span>
	</Select.Trigger>
	<Select.Content>
		{#each Object.entries(options) as [name, expr] (name)}
			{@const glyph = glyphOf(name)}
			<Select.Item value={expr ?? name} label={name}>
				{#if glyph}<OptionGlyph {glyph} />{/if}
				{name}
			</Select.Item>
		{/each}
	</Select.Content>
</Select.Root>
