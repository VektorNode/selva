<script lang="ts">
	import type { DropdownWidgetConfig, SupportedTypes, UISchema } from '@selvajs/schemas';
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

	const options = $derived(
		Object.entries(config.options ?? {}).map(([name, expr]) => ({ name, value: expr ?? name }))
	);
	// With nothing selected the first tile takes focus, so the group is still reachable by Tab.
	const focusIndex = $derived(
		Math.max(
			0,
			options.findIndex((o) => o.value === value)
		)
	);

	let tiles: HTMLButtonElement[] = $state([]);

	function onKeydown(event: KeyboardEvent, index: number) {
		const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
		if (!step) return;
		event.preventDefault();
		const next = (index + step + options.length) % options.length;
		onChange(options[next].value);
		tiles[next]?.focus();
	}
</script>

<div role="radiogroup" aria-labelledby={labelId} class="gap-2 tile-grid grid">
	{#each options as option, index (option.name)}
		{@const glyph = optionGlyph(config.optionMedia?.[option.name], assets, 'image')}
		{@const selected = option.value === value}
		<button
			bind:this={tiles[index]}
			type="button"
			role="radio"
			aria-checked={selected}
			tabindex={index === focusIndex ? 0 : -1}
			{disabled}
			onclick={() => onChange(option.value)}
			onkeydown={(e) => onKeydown(e, index)}
			class="gap-1.5 p-1.5 min-w-0 flex flex-col rounded-lg border text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 {selected
				? 'border-primary bg-primary/5 ring-1 ring-primary'
				: 'border-input hover:bg-accent/40'}"
		>
			<span
				class="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground"
			>
				{#if glyph?.kind === 'image'}
					<OptionGlyph {glyph} class="size-full" />
				{:else if glyph}
					<OptionGlyph {glyph} class="size-7" />
				{:else}
					<span class="text-lg font-medium" aria-hidden="true">{option.name.charAt(0)}</span>
				{/if}
			</span>
			<span class="px-0.5 text-xs leading-tight truncate" class:font-medium={selected}>
				{option.name}
			</span>
		</button>
	{/each}
</div>

<style>
	/* Two or three tiles a row as the panel narrows; a fixed count shrinks them to unreadable. */
	.tile-grid {
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
	}
</style>
