<script lang="ts">
	// The three-step story drawn as a wired canvas rather than three cards in a
	// row. Hovering a node lights it and the wire leaving it — done in CSS via
	// group-hover, so there's no interaction handler on non-interactive content.
	interface Node {
		id: string;
		step: string;
		title: string;
		body: string;
	}

	const nodes: Node[] = [
		{
			id: 'design',
			step: 'Design',
			title: 'On the Grasshopper canvas',
			body: 'Drop in the Selva UI Builder and drag parameters onto web controls. The layout saves into the .gh file.'
		},
		{
			id: 'solve',
			step: 'Solve',
			title: 'On Rhino.Compute',
			body: 'A headless Rhino runs the definition. Caching and single-flight keep repeat solves cheap.'
		},
		{
			id: 'share',
			step: 'Share',
			title: 'In a browser',
			body: 'Send a link. Anyone changes values and watches geometry update. No Rhino, no install.'
		}
	];
</script>

<div class="grid gap-4 md:grid-cols-3">
	{#each nodes as node, i (node.id)}
		<div class="group relative">
			<!-- Wire to the next node. Hidden on the last, and on narrow screens. -->
			{#if i < nodes.length - 1}
				<div class="absolute top-12 -right-4 hidden w-8 md:block" aria-hidden="true">
					<div
						class="bg-border group-hover:bg-primary h-px w-full transition-colors duration-300"
					></div>
				</div>
			{/if}

			<div
				class="border-border bg-card group-hover:border-primary/50 h-full rounded-xl border p-5 transition-colors duration-300"
			>
				<!-- Param-style header, the way a GH component labels its ports. -->
				<div class="flex items-center gap-2">
					<span
						class="bg-muted-foreground/40 group-hover:bg-primary size-2 rounded-full transition-colors duration-300"
					></span>
					<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
						{node.step}
					</span>
				</div>
				<h3 class="mt-3 font-semibold">{node.title}</h3>
				<p class="text-muted-foreground mt-2 text-sm leading-relaxed">{node.body}</p>
			</div>
		</div>
	{/each}
</div>
