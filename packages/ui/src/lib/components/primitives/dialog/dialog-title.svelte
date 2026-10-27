<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import { cn } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		size = 'default',
		...restProps
	}: DialogPrimitive.TitleProps & {
		/** `sm` for compact, popover-like dialogs that title a single object. */
		size?: 'default' | 'sm';
	} = $props();
</script>

<DialogPrimitive.Title
	bind:ref
	data-slot="dialog-title"
	class={cn('font-semibold leading-none', size === 'sm' ? 'text-sm' : 'text-lg', className)}
	{...restProps}
/>
