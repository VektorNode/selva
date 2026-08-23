<script lang="ts">
	import { page } from '$app/state';
	import { getDocsSidebar } from '$lib/docs';

	let { children } = $props();

	const docsNav = getDocsSidebar();

	let article = $state<HTMLElement>();

	// Wire up the copy button baked into every Shiki code block (see svelte.config.js).
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
</script>

<div class="mx-auto flex max-w-7xl gap-10 px-6 py-12">
	<!-- Sidebar -->
	<aside class="hidden w-56 shrink-0 md:block">
		<nav class="sticky top-24 space-y-6">
			{#each docsNav as section (section.title)}
				<div>
					<h3 class="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
						{section.title}
					</h3>
					<ul class="mt-2 space-y-1">
						{#each section.links as link (link.href)}
							{@const active = page.url.pathname === link.href}
							<li>
								<a
									href={link.href}
									class="block rounded-md px-3 py-1.5 text-sm transition {active
										? 'bg-muted text-foreground font-medium'
										: 'text-muted-foreground hover:text-foreground hover:bg-muted/60'}"
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}

			<p class="text-muted-foreground border-border border-t pt-4 text-xs leading-relaxed">
				More docs — plugin, providers, deployment — arrive with the first release.
			</p>
		</nav>
	</aside>

	<!-- Content -->
	<article bind:this={article} class="prose prose-headings:scroll-mt-24 max-w-none min-w-0 flex-1">
		{@render children()}
	</article>
</div>
