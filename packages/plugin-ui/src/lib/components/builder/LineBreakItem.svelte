<script lang="ts">
	import type { LineBreakLayoutItem } from '@selvajs/schemas';
	import { GripVertical } from '@lucide/svelte';
	import { dragHandle } from 'svelte-dnd-action';

	interface Props {
		item: LineBreakLayoutItem;
		onRemove: () => void;
	}

	let { item: _item, onRemove }: Props = $props();
</script>

<div
	class="group/lb relative flex items-center gap-2 rounded px-1 py-2 transition-all select-none"
	role="separator"
	aria-label="Line break — drag to reorder"
>
	<div
		use:dragHandle
		class="text-muted-foreground cursor-grab opacity-0 transition-opacity group-hover/lb:opacity-100 active:cursor-grabbing"
	>
		<GripVertical size={14} />
	</div>

	<div class="bg-border h-px flex-1"></div>

	<span class="text-muted-foreground text-[10px] font-medium tracking-widest uppercase">
		line break
	</span>

	<div class="bg-border h-px flex-1"></div>

	<button
		class="text-muted-foreground hover:text-destructive text-xs leading-none opacity-0 transition-colors group-hover/lb:opacity-100"
		onclick={(e) => {
			e.stopPropagation();
			onRemove();
		}}
		aria-label="Remove line break">×</button
	>
</div>
