<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLSpanElement>> = $props();
</script>

<span
	bind:this={ref}
	data-slot="dropdown-menu-shortcut"
	class={cn(
		'h-5 min-w-5 px-1 font-mono ml-auto inline-flex items-center justify-center rounded-sm border bg-muted text-2xs text-muted-foreground group-focus/dropdown-menu-item:text-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</span>
