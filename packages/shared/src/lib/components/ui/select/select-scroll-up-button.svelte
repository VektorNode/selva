<script lang="ts">
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import { Select as SelectPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';

	let {
		ref = $bindable(null),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<SelectPrimitive.ScrollUpButtonProps> = $props();
</script>

<SelectPrimitive.ScrollUpButton
	bind:ref
	data-slot="select-scroll-up-button"
	class={cn('py-1 flex cursor-default items-center justify-center', className)}
	{...restProps}
>
	<ChevronUpIcon class="size-4" />
</SelectPrimitive.ScrollUpButton>
