<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
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
	data-slot="command-shortcut"
	class={cn(
		'text-xs tracking-widest ml-auto text-muted-foreground group-data-selected/command-item:text-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</span>
