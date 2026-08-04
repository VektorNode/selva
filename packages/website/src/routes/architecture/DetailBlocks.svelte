<script lang="ts">
	import type { DetailBlock } from '$lib/architecture';
	import DebounceDemo from './demos/DebounceDemo.svelte';
	import LruDemo from './demos/LruDemo.svelte';
	import ThrottleDemo from './demos/ThrottleDemo.svelte';
	import SingleFlightDemo from './demos/SingleFlightDemo.svelte';
	import QueueDemo from './demos/QueueDemo.svelte';

	// A demo block names its component here. Statically mapped rather than
	// dynamically imported so an unknown name fails visibly in dev and the whole
	// set is greppable from one place.
	const DEMOS: Record<string, typeof DebounceDemo> = {
		DebounceDemo,
		LruDemo,
		ThrottleDemo,
		SingleFlightDemo,
		QueueDemo
	};

	let { blocks }: { blocks: DetailBlock[] } = $props();
</script>

<div class="space-y-3">
	{#each blocks as block, i (i)}
		{#if block.kind === 'prose'}
			<p class="text-muted-foreground text-sm leading-relaxed">{block.text}</p>
		{:else if block.kind === 'facts'}
			<dl class="border-border divide-border divide-y rounded-md border text-sm">
				{#each block.rows as [label, value] (label)}
					<div class="flex flex-wrap gap-x-3 px-3 py-1.5">
						<dt class="text-muted-foreground w-44 shrink-0 text-xs">{label}</dt>
						<dd class="min-w-0 flex-1 text-xs">{value}</dd>
					</div>
				{/each}
			</dl>
		{:else if block.kind === 'code'}
			<pre class="bg-muted overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed"><code
					>{block.text}</code
				></pre>
		{:else if block.kind === 'mapping'}
			<div class="border-border overflow-hidden rounded-md border">
				<div
					class="border-border text-muted-foreground grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 border-b px-3 py-1.5 text-[11px] font-medium tracking-wide uppercase"
				>
					<span>{block.from}</span>
					<span aria-hidden="true"></span>
					<span>{block.to}</span>
				</div>
				{#each block.rows as [from, to] (from)}
					<div
						class="border-border grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 px-3 py-1.5 not-last:border-b"
					>
						<code class="font-mono text-xs">{from}</code>
						<span class="text-muted-foreground text-xs" aria-hidden="true">→</span>
						<code class="text-primary font-mono text-xs">{to}</code>
					</div>
				{/each}
			</div>
		{:else if block.kind === 'warning'}
			<div class="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
				<p class="text-xs font-semibold text-amber-700 dark:text-amber-400">{block.title}</p>
				<p class="text-muted-foreground mt-1 text-xs leading-relaxed">{block.text}</p>
			</div>
		{:else if block.kind === 'pipeline'}
			<div class="flex flex-wrap items-stretch gap-2">
				{#each block.stages as stage, i (stage.label)}
					<div
						class="border-border bg-card min-w-32 flex-1 rounded-md border px-3 py-2 {stage.terminal
							? 'border-primary/40 bg-primary/5'
							: ''}"
					>
						<p class="text-sm font-semibold">{stage.label}</p>
						<p class="text-muted-foreground mt-0.5 text-[11px] leading-snug">{stage.sub}</p>
					</div>
					{#if i < block.stages.length - 1}
						<span class="text-muted-foreground flex items-center px-0.5" aria-hidden="true">→</span>
					{/if}
				{/each}
			</div>
		{:else if block.kind === 'demo'}
			{@const Demo = DEMOS[block.component]}
			{#if Demo}
				<div class="border-border bg-muted/30 rounded-md border p-3">
					<p class="text-muted-foreground mb-2.5 text-[11px] font-medium tracking-wide uppercase">
						Try it
					</p>
					<Demo />
					{#if block.caption}
						<p class="text-muted-foreground mt-2.5 text-xs">{block.caption}</p>
					{/if}
				</div>
			{/if}
		{/if}
	{/each}
</div>
