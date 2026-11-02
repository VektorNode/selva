<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';

	interface TocHeading {
		id: string;
		text: string;
		level: 2 | 3;
	}

	/**
	 * `article` holds the rendered doc; `path` changes when the doc swaps. `rail` is the sticky
	 * column; `dropdown` is the same list behind a button, for screens too narrow for the column.
	 */
	let {
		article,
		path,
		variant = 'rail'
	}: { article: HTMLElement | undefined; path: string; variant?: 'rail' | 'dropdown' } = $props();

	let menu = $state<HTMLDetailsElement>();

	let headings = $state<TocHeading[]>([]);
	let activeId = $state('');

	/** The heading's own words: the autolink anchor appended by rehype is not part of them. */
	function headingText(el: HTMLElement): string {
		let text = '';
		for (const node of el.childNodes) {
			if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
			else if (node instanceof HTMLElement && node.tagName !== 'A') text += node.textContent;
		}
		return text.trim();
	}

	$effect(() => {
		void path;
		const root = article;
		if (!root) return;

		const els = [...root.querySelectorAll<HTMLHeadingElement>('h2[id], h3[id]')];
		headings = els.map((el) => ({
			id: el.id,
			text: headingText(el),
			level: el.tagName === 'H2' ? 2 : 3
		}));
		activeId = els[0]?.id ?? '';
		if (els.length === 0) return;

		// A plain Set: bookkeeping local to this effect, never read in markup.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const visible = new Set<string>();
		// The band starts below the floating header and ends at 2/3 of the viewport, so the active
		// heading is the first one the reader has reached rather than the last one scrolled past.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) visible.add(entry.target.id);
					else visible.delete(entry.target.id);
				}
				const first = els.find((el) => visible.has(el.id));
				if (first) activeId = first.id;
			},
			{ rootMargin: '-96px 0px -66% 0px' }
		);
		for (const el of els) observer.observe(el);
		return () => observer.disconnect();
	});
</script>

{#snippet list()}
	<ul class="border-border space-y-0.5 border-l">
		{#each headings as heading (heading.id)}
			{@const active = heading.id === activeId}
			<li>
				<a
					href={`#${heading.id}`}
					aria-current={active ? 'location' : undefined}
					class="-ml-px block border-l py-1 pr-2 text-sm leading-snug transition {heading.level ===
					3
						? 'pl-6'
						: 'pl-3'} {active
						? 'border-primary text-foreground font-medium'
						: 'text-muted-foreground hover:text-foreground hover:border-muted-foreground/40 border-transparent'}"
				>
					{heading.text}
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#if headings.length > 1}
	{#if variant === 'dropdown'}
		<details bind:this={menu} class="group relative">
			<summary
				class="border-border text-foreground flex cursor-pointer list-none items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden"
			>
				On this page
				<ChevronDown class="text-muted-foreground size-3.5 transition group-open:rotate-180" />
			</summary>
			<!-- A tap on a link jumps to the heading, so the panel closes behind it. -->
			<div
				role="presentation"
				onclick={() => menu && (menu.open = false)}
				class="border-border bg-popover absolute right-0 z-40 mt-2 max-h-(--docs-sticky-h) w-72 overflow-y-auto rounded-lg border p-4 shadow-lg"
			>
				{@render list()}
			</div>
		</details>
	{:else}
		<nav aria-label="On this page">
			<h2 class="text-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
				On this page
			</h2>
			{@render list()}
		</nav>
	{/if}
{/if}
