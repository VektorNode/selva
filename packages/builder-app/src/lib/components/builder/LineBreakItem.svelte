<script lang="ts">
	import type { LineBreakLayoutItem } from '@selva/shared';
	import { GripVertical } from '@lucide/svelte';

	interface Props {
		item: LineBreakLayoutItem;
		onRemove: () => void;
	}

	let { item: _item, onRemove }: Props = $props();
</script>

<div
	class="group/lb relative flex cursor-grab items-center gap-2 rounded px-1 py-2 select-none transition-all active:cursor-grabbing"
	role="separator"
	aria-label="Line break — drag to reorder"
>
	<!-- Grip handle -->
	<div class="text-muted-foreground opacity-0 transition-opacity group-hover/lb:opacity-100">
		<GripVertical size={14} />
	</div>

	<!-- Left rule -->
	<div class="bg-border h-px flex-1"></div>

	<!-- Center label -->
	<span class="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
		line break
	</span>

	<!-- Right rule -->
	<div class="bg-border h-px flex-1"></div>

	<!-- Remove button -->
	<button
		class="text-muted-foreground hover:text-destructive text-xs leading-none opacity-0 transition-colors group-hover/lb:opacity-100"
		onclick={(e) => { e.stopPropagation(); onRemove(); }}
		aria-label="Remove line break"
	>×</button>
</div>
