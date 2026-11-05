<script lang="ts">
	import { page } from '$app/state';
	import type { DocSidebarGroup } from '#lib/docs.js';
	import DocsNav from './DocsNav.svelte';
	import TableOfContents from './TableOfContents.svelte';
	import Menu from '@lucide/svelte/icons/menu';
	import X from '@lucide/svelte/icons/x';

	let { groups, article }: { groups: DocSidebarGroup[]; article: HTMLElement | undefined } =
		$props();

	let drawer = $state<HTMLDialogElement>();

	// A tap on a nav link navigates; the drawer then has nothing left to do.
	$effect(() => {
		void page.url.pathname;
		drawer?.close();
	});
</script>

<!-- Phones get the nav in a drawer; anything below the wide layout gets the outline as a
     dropdown. Both sit in one sticky bar under the floating header. -->
<div
	class="border-border bg-background md:before:bg-background relative mb-6 flex items-center justify-between gap-3 md:sticky md:top-(--docs-bar-top) md:z-30 md:border-b md:py-2 md:before:absolute md:before:inset-x-0 md:before:bottom-full md:before:h-4 xl:hidden"
>
	<div class="ml-auto">
		<TableOfContents {article} path={page.url.pathname} variant="dropdown" />
	</div>
</div>

<!-- Floating burger in the thumb zone, bottom-left. -->
<button
	type="button"
	onclick={() => drawer?.showModal()}
	aria-label="Open docs navigation"
	class="border-border bg-background/90 text-foreground bottom-safe fixed left-4 z-40 flex size-12 items-center justify-center rounded-full border shadow-lg backdrop-blur active:scale-95 md:hidden"
>
	<Menu class="size-5" aria-hidden="true" />
</button>

<dialog
	bind:this={drawer}
	aria-label="Docs navigation"
	onclick={(e) => e.target === drawer && drawer?.close()}
	class="drawer text-foreground m-0 h-dvh max-h-none w-80 max-w-5/6 overflow-y-auto p-6 md:hidden"
>
	<div class="mb-6 flex items-center justify-between">
		<span class="text-sm font-semibold">Documentation</span>
		<button
			type="button"
			onclick={() => drawer?.close()}
			aria-label="Close navigation"
			class="text-muted-foreground hover:text-foreground rounded-md p-1 transition"
		>
			<X class="size-5" />
		</button>
	</div>
	<div class="drawer-body"><DocsNav {groups} /></div>
</dialog>

<style>
	/* Lock page scroll while the drawer is open; :has() follows the dialog's [open] state. */
	:global(html:has(.drawer[open])),
	:global(body:has(.drawer[open])) {
		overflow: hidden;
	}

	/* Frosted glass: translucent tint + blur/saturate of what sits behind. */
	.drawer {
		overscroll-behavior: contain;
		background: color-mix(in oklab, var(--background) 38%, transparent);
		backdrop-filter: blur(24px) saturate(1.6);
		border-right: 1px solid color-mix(in oklab, white 12%, transparent);
		box-shadow: 8px 0 40px -8px color-mix(in oklab, black 55%, transparent);
		translate: -105% 0;
		opacity: 0;
		transition:
			translate 0.28s cubic-bezier(0.4, 0, 1, 1),
			opacity 0.22s ease-in,
			overlay 0.3s allow-discrete,
			display 0.3s allow-discrete;
	}
	.drawer[open] {
		translate: 0 0;
		opacity: 1;
		transition:
			translate 0.5s cubic-bezier(0.16, 1, 0.3, 1),
			opacity 0.25s ease-out,
			overlay 0.5s allow-discrete,
			display 0.5s allow-discrete;
	}
	@starting-style {
		.drawer[open] {
			translate: -105% 0;
			opacity: 0;
		}
	}

	/* Content trails the panel slightly. */
	.drawer-body,
	.drawer > div:first-child {
		opacity: 0;
		translate: -16px 0;
		transition:
			opacity 0.2s ease-in,
			translate 0.2s ease-in;
	}
	.drawer[open] .drawer-body,
	.drawer[open] > div:first-child {
		opacity: 1;
		translate: 0 0;
		transition:
			opacity 0.4s ease-out 0.12s,
			translate 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.12s;
	}
	@starting-style {
		.drawer[open] .drawer-body,
		.drawer[open] > div:first-child {
			opacity: 0;
			translate: -16px 0;
		}
	}

	.drawer::backdrop {
		background: color-mix(in oklab, black 25%, transparent);
		backdrop-filter: blur(0);
		opacity: 0;
		transition:
			opacity 0.3s ease,
			backdrop-filter 0.3s ease,
			overlay 0.3s allow-discrete,
			display 0.3s allow-discrete;
	}
	.drawer[open]::backdrop {
		opacity: 1;
		backdrop-filter: blur(6px);
		transition-duration: 0.5s;
	}
	@starting-style {
		.drawer[open]::backdrop {
			opacity: 0;
			backdrop-filter: blur(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.drawer,
		.drawer[open],
		.drawer-body,
		.drawer > div:first-child,
		.drawer::backdrop {
			transition-duration: 0.01s !important;
			transition-delay: 0s !important;
		}
	}
</style>
