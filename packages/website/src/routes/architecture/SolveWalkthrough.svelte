<script lang="ts">
	// One fixed solve, shown whole: radius 12.5 and capped true go in, area comes
	// back. The point is the shape change at each hop — a bare value becomes a
	// named tree, and comes back carrying a .NET type it didn't have going out —
	// so both bodies are on the page at once rather than replacing each other.
	interface Hop {
		/** null on the solve itself: nothing travels while it happens. */
		from: string | null;
		to: string | null;
		at: string;
		title: string;
		explain: string;
		headers: string[];
		body: string;
		/** What this hop did to the body it received. */
		transform: string | null;
	}

	const HOPS: Hop[] = [
		{
			from: 'Browser',
			to: 'Selva server',
			at: 'Browser',
			title: 'The browser sends what changed',
			explain:
				'Both input values go up in one JSON body — a flat object, one key per input. This is the only shape a person ever writes by hand.',
			headers: ['POST /api/v1/solve', 'Content-Type: application/json', 'Cookie: admin_session=…'],
			body: `{ "values": { "radius": 12.5, "capped": true } }`,
			transform: null
		},
		{
			from: 'Selva server',
			to: 'Rhino.Compute',
			at: 'Selva server',
			title: 'Selva repacks it for Grasshopper',
			explain:
				'Grasshopper addresses inputs by parameter name, and every input is a tree even when it holds one item. So each bare value gets wrapped: the name it is wired to, and a tree with a single branch {0}. The server attaches its own key here — the browser never holds it.',
			headers: ['POST /grasshopper', 'Content-Type: application/json', 'RhinoComputeKey: ••••••'],
			body: `{
  "pointer": "md5:7ab3…",
  "values": [
    { "ParamName": "radius",
      "InnerTree": { "{0}": [{ "data": 12.5 }] } },
    { "ParamName": "capped",
      "InnerTree": { "{0}": [{ "data": true }] } }
  ]
}`,
			transform: 'each value wrapped in its param name + a one-branch tree'
		},
		{
			from: null,
			to: null,
			at: 'Rhino.Compute',
			title: 'The solve happens here',
			explain:
				'Nothing travels during this step. Grasshopper is already open on the Rhino.Compute machine; it plugs the two values into the definition and recomputes. Every hop before this was getting the inputs to this machine, and every hop after is getting the answer back out.',
			headers: [],
			body: '',
			transform: null
		},
		{
			from: 'Rhino.Compute',
			to: 'Selva server',
			at: 'Rhino.Compute',
			title: 'Rhino answers with more than it got',
			explain:
				'One tree per output, in the same shape as the request — but each item now carries its .NET type, and the value comes back as a string. Rhino knows exactly what kind of thing it produced, and says so.',
			headers: ['200 OK', 'Server-Timing: decode;dur=1, solve;dur=4, encode;dur=1'],
			body: `{
  "values": [
    { "ParamName": "area",
      "InnerTree": { "{0}": [
        { "type": "System.Double", "data": "490.9" }
      ] } }
  ]
}`,
			transform: 'same tree shape, plus a .NET type on every item'
		},
		{
			from: 'Selva server',
			to: 'Browser',
			at: 'Selva server',
			title: 'Selva flattens it and sends it back',
			explain:
				'The tree collapses back to a plain value, typed as JSON rather than .NET. The body the browser receives mirrors the one it sent — flat, one key per output — so nothing in the page ever handles a tree.',
			headers: [
				'200 OK',
				'Content-Encoding: gzip',
				'Server-Timing: tree;dur=2, rhino_solve;dur=4, total;dur=23'
			],
			body: `{ "outputs": { "area": 490.9 } }`,
			transform: 'tree flattened back to a plain value'
		}
	];

	// dur values in ms, drawn to scale. Illustrates the header format above —
	// one real solve's numbers, not a benchmark.
	const TIMING = [
		{ label: 'find the definition', dur: 0 },
		{ label: 'build the input tree', dur: 2 },
		{ label: 'Rhino: decode', dur: 1 },
		{ label: 'Rhino: solve', dur: 4 },
		{ label: 'Rhino: encode', dur: 1 },
		{ label: 'turn the result into JSON', dur: 14 },
		{ label: 'gzip it', dur: 6 }
	];
	const TIMING_TOTAL = 23;
</script>

<div class="space-y-3">
	{#each HOPS as hop, i (hop.at + hop.title)}
		{#if hop.transform}
			<!-- What the hop above did, sitting between the two bodies it connects. -->
			<div class="text-muted-foreground flex items-center gap-2 pl-3 text-[11px] italic">
				<span aria-hidden="true">↓</span>
				{hop.transform}
			</div>
		{/if}

		<div
			class="rounded-md border p-3 {hop.from === null
				? 'border-orange-500/30 bg-orange-500/5'
				: 'border-border bg-muted/30'}"
		>
			<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<p class="text-sm font-semibold">
					<span class="text-muted-foreground mr-1.5 font-mono text-[11px] tabular-nums"
						>{i + 1}</span
					>{hop.title}
				</p>
				<span class="text-muted-foreground font-mono text-[10px]">
					{#if hop.from}
						{hop.from} → {hop.to}
					{:else}
						on {hop.at}
					{/if}
				</span>
			</div>
			<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">{hop.explain}</p>

			{#if hop.body}
				<div class="border-border/60 mt-3 space-y-0.5 border-t pt-2.5">
					{#each hop.headers as header (header)}
						<p class="text-muted-foreground font-mono text-[11px] leading-relaxed">{header}</p>
					{/each}
				</div>
				<pre
					class="text-foreground mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">{hop.body}</pre>
			{/if}
		</div>
	{/each}

	<!-- Server-Timing, decoded: the same numbers as the last header, one bar each. -->
	<div class="border-border bg-muted/30 rounded-md border p-3">
		<p class="text-sm font-semibold">Where those 23ms went</p>
		<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">
			The <code class="bg-muted rounded px-1 py-0.5 font-mono text-[11px]">Server-Timing</code> header
			above, drawn to scale. The solve itself is 4ms of it — most of the time goes into turning the result
			into JSON and compressing it, which is what you tune when a solve feels slow.
		</p>
		<div class="mt-3 space-y-1">
			{#each TIMING as t (t.label)}
				<div class="flex items-center gap-2">
					<span class="text-muted-foreground w-36 shrink-0 text-[11px]">{t.label}</span>
					<div class="bg-border/60 h-2.5 flex-1 overflow-hidden rounded-sm">
						<div
							class="h-full rounded-sm bg-sky-500/70"
							style="width: {Math.max(3, (t.dur / TIMING_TOTAL) * 100)}%"
						></div>
					</div>
					<span
						class="text-muted-foreground w-10 shrink-0 text-right font-mono text-[11px] tabular-nums"
					>
						{t.dur}ms
					</span>
				</div>
			{/each}
			<p class="text-muted-foreground pt-0.5 text-[11px]">total: {TIMING_TOTAL}ms</p>
		</div>
	</div>
</div>
