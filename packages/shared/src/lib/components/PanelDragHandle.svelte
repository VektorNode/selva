<script lang="ts">
	interface Props {
		onDragStart: (e: MouseEvent) => void;
		ariaLabel: string;
	}

	let { onDragStart, ariaLabel }: Props = $props();
</script>

<div
	class="lg:flex group hidden shrink-0 cursor-ew-resize items-center justify-center transition-colors hover:bg-primary/10 active:bg-primary/20"
	style="width: 6px"
	onmousedown={onDragStart}
	role="button"
	tabindex="0"
	aria-label={ariaLabel}
>
	<div class="h-8 w-px rounded-full bg-border transition-colors group-hover:bg-primary/50"></div>
</div>
