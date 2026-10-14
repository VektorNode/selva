<script lang="ts">
	import { cn, type WithElementRef } from '$lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-header"
	class={cn(
		'gap-1.5 px-6 [.border-b]:pb-6 @container/card-header grid auto-rows-min items-start',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
