<script lang="ts">
	import { page } from '$app/state';
	import type { DocSidebarGroup } from '$lib/docs';
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
	class="border-border bg-background/90 sticky top-(--docs-bar-top) z-30 -mx-4 mb-6 flex items-center justify-between gap-3 border-b px-4 py-2 backdrop-blur md:mx-0 md:px-0 xl:hidden"
>
	<button
		type="button"
		onclick={() => drawer?.showModal()}
		class="border-border text-foreground flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm md:hidden"
	>
		<Menu class="size-4" aria-hidden="true" /> Menu
	</button>
	<div class="ml-auto">
		<TableOfContents {article} path={page.url.pathname} variant="dropdown" />
	</div>
</div>

<dialog
	bind:this={drawer}
	aria-label="Docs navigation"
	onclick={(e) => e.target === drawer && drawer?.close()}
	class="bg-background text-foreground m-0 h-dvh max-h-none w-80 max-w-5/6 overflow-y-auto p-6 backdrop:bg-(--overlay) md:hidden"
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
	<DocsNav {groups} />
</dialog>
