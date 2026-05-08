<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn, type WithElementRef } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="alert-description"
	class={cn(
		'gap-1 text-sm [&_p]:leading-relaxed col-start-2 grid justify-items-start text-muted-foreground',
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
