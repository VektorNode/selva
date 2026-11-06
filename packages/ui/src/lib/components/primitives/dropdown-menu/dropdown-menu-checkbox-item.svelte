<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import MinusIcon from '@lucide/svelte/icons/minus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		children: childrenProp,
		closeOnSelect = false,
		switch: asSwitch = false,
		...restProps
	}: WithoutChildrenOrChild<DropdownMenuPrimitive.CheckboxItemProps> & {
		children?: Snippet;
		/** Shows an on/off switch at the row's end instead of a checkmark. */
		switch?: boolean;
	} = $props();
</script>

<DropdownMenuPrimitive.CheckboxItem
	bind:ref
	{closeOnSelect}
	bind:checked
	bind:indeterminate
	data-slot="dropdown-menu-checkbox-item"
	class={cn(
		asSwitch ? 'pr-2 gap-2.5' : 'pr-8',
		"gap-1.5 py-1 pointer-coarse:py-2.5 pl-1.5 text-sm data-inset:pl-7 [&_svg:not([class*='size-'])]:size-4 relative flex cursor-default items-center rounded-inner outline-hidden select-none focus:bg-hover focus:text-foreground focus:**:text-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
		className
	)}
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		{@render childrenProp?.()}
		{#if asSwitch}
			<span
				class="not-pointer-coarse:[[data-slot=dropdown-menu-shortcut]+&]:ml-2 h-4.5 w-8 pointer-events-none relative ml-auto shrink-0 rounded-full transition-colors {checked
					? 'bg-primary'
					: 'bg-input'}"
				data-slot="dropdown-menu-checkbox-item-switch"
				aria-hidden="true"
			>
				<span
					class="left-0.5 top-0.5 size-3.5 absolute rounded-full bg-background transition-transform dark:bg-foreground {checked
						? 'translate-x-3.5 dark:bg-primary-foreground'
						: ''}"
				></span>
			</span>
		{:else}
			<span
				class="right-2 pointer-events-none absolute flex items-center justify-center"
				data-slot="dropdown-menu-checkbox-item-indicator"
			>
				{#if indeterminate}
					<MinusIcon />
				{:else if checked}
					<CheckIcon />
				{/if}
			</span>
		{/if}
	{/snippet}
</DropdownMenuPrimitive.CheckboxItem>
