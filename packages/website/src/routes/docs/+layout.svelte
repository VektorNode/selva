<script lang="ts">
	import { page } from '$app/state';
	import { getDoc, getDocsSidebar } from '#lib/docs.js';
	import Breadcrumbs from '#lib/components/docs/Breadcrumbs.svelte';
	import DocsBar from '#lib/components/docs/DocsBar.svelte';
	import DocsNav from '#lib/components/docs/DocsNav.svelte';
	import TableOfContents from '#lib/components/docs/TableOfContents.svelte';

	let { children } = $props();

	const docsNav = getDocsSidebar();

	const entry = $derived(page.params.slug ? getDoc(page.params.slug) : undefined);
	const crumbs = $derived(
		entry ? [{ label: 'Docs', href: '/docs' }, { label: entry.group }, { label: entry.title }] : []
	);

	let article = $state<HTMLElement>();

	// Wire up the copy button baked into every Shiki code block (see mdsvex.config.js).
	// Re-runs on navigation since page.url changes when the rendered doc swaps.
	$effect(() => {
		// Touch page.url so this re-runs when the route (and thus the markup) changes.
		void page.url.pathname;
		const root = article;
		if (!root) return;

		const buttons = root.querySelectorAll<HTMLButtonElement>('.code-copy');
		// Plain Maps: imperative bookkeeping local to this effect, never read in markup.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const timers = new Map<HTMLButtonElement, ReturnType<typeof setTimeout>>();

		async function copy(btn: HTMLButtonElement) {
			const encoded = btn.closest<HTMLElement>('.code-block')?.dataset.code;
			if (!encoded) return;
			try {
				const code = new TextDecoder().decode(
					Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
				);
				await navigator.clipboard.writeText(code);
				btn.textContent = 'Copied!';
				btn.classList.add('is-copied');
				clearTimeout(timers.get(btn));
				timers.set(
					btn,
					setTimeout(() => {
						btn.textContent = 'Copy';
						btn.classList.remove('is-copied');
					}, 2000)
				);
			} catch (err) {
				console.error('Failed to copy code:', err);
			}
		}

		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const handlers = new Map<HTMLButtonElement, () => void>();
		for (const btn of buttons) {
			const handler = () => copy(btn);
			handlers.set(btn, handler);
			btn.addEventListener('click', handler);
		}

		return () => {
			for (const [btn, handler] of handlers) btn.removeEventListener('click', handler);
			for (const timer of timers.values()) clearTimeout(timer);
		};
	});

	// The index is a card grid with no headings, so it takes the outline column's width too.
	const isIndex = $derived(page.url.pathname.replace(/\/$/, '') === '/docs');
</script>

<div class="mx-auto flex max-w-(--page-max-w) gap-10 px-6 py-6 md:py-12">
	<!-- Sidebar -->
	<aside class="hidden w-(--docs-nav-w) shrink-0 md:block">
		<div class="sticky top-(--docs-top) max-h-(--docs-sticky-h) overflow-y-auto pr-2">
			<DocsNav groups={docsNav} />
		</div>
	</aside>

	<!-- Content -->
	<div class="min-w-0 flex-1">
		<div class={isIndex ? '' : 'mx-auto max-w-(--docs-measure)'}>
			<DocsBar groups={docsNav} {article} />
			<Breadcrumbs items={crumbs} />
			<article bind:this={article} class="prose prose-headings:scroll-mt-32 max-w-none">
				{@render children()}
			</article>
		</div>
	</div>

	<!-- On this page -->
	{#if !isIndex}
		<aside class="hidden w-(--docs-toc-w) shrink-0 xl:block">
			<div class="sticky top-(--docs-top) max-h-(--docs-sticky-h) overflow-y-auto">
				<TableOfContents {article} path={page.url.pathname} />
			</div>
		</aside>
	{/if}
</div>
