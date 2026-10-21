<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import XIcon from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import * as Dialog from './index.js';
	import { cn, type WithoutChildrenOrChild } from '$lib/utils.js';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

	let {
		ref = $bindable(null),
		class: className,
		portalProps,
		children,
		showCloseButton = true,
		variant = 'default',
		...restProps
	}: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & {
		portalProps?: DialogPrimitive.PortalProps;
		children: Snippet;
		showCloseButton?: boolean;
		/** `flush` drops padding and gap, for content that draws its own sections edge to edge. */
		variant?: 'default' | 'flush';
	} = $props();

	const locale = getLocaleContext();
</script>

<Dialog.Portal {...portalProps}>
	<Dialog.Overlay />
	<DialogPrimitive.Content
		bind:ref
		data-slot="dialog-content"
		class={cn(
			variant === 'flush' ? 'gap-0' : 'gap-4 p-6',
			'shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg fixed top-1/2 left-1/2 z-50 grid max-h-dialog w-screen-inset -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background duration-200',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
		{#if showCloseButton}
			<!-- 24px around the 16px icon, and 44px of hit area on touch, without moving the icon. -->
			<DialogPrimitive.Close
				class="end-3 top-3 p-1 rounded-xs [&_svg:not([class*='size-'])]:size-4 pointer-coarse:after:-inset-2.5 absolute opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none pointer-coarse:after:absolute [&_svg]:pointer-events-none [&_svg]:shrink-0"
			>
				<XIcon />
				<span class="sr-only">{locale.messages.close}</span>
			</DialogPrimitive.Close>
		{/if}
	</DialogPrimitive.Content>
</Dialog.Portal>
