<script lang="ts">
	import { Tabs as TabsPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		value = $bindable(''),
		class: className,
		variant = 'default',
		...restProps
	}: TabsPrimitive.RootProps & {
		/** Match the list's variant: `line` tabs sit flush on their panel, so the gap goes. */
		variant?: 'default' | 'line';
	} = $props();
</script>

<TabsPrimitive.Root
	bind:ref
	bind:value
	data-slot="tabs"
	class={cn('flex flex-col', variant === 'line' ? 'gap-0' : 'gap-2', className)}
	{...restProps}
/>
