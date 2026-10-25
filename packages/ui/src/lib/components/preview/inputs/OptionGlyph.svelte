<script lang="ts">
	import type { GlyphSource } from '$lib/schema/option-display';
	import { cn } from '$lib/utils.js';

	interface Props {
		glyph: GlyphSource;
		class?: string;
	}

	let { glyph, class: className }: Props = $props();
</script>

{#if glyph.kind === 'icon'}
	<!-- Lucide's stroke defaults; the path is bound as an attribute, never parsed as markup. -->
	<svg
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
		class={cn('size-4 shrink-0', className)}
	>
		<path d={glyph.d} />
	</svg>
{:else}
	<img src={glyph.src} alt="" class={cn('object-cover', className)} />
{/if}
