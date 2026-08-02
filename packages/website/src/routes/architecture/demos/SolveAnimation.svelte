<script lang="ts">
	// Cosmetic controls: the slider/toggle make the demo feel like a real form,
	// but the walk is one fixed example — real shapes, not a live solve. `capped`
	// really does flow into every stage's body, and re-solving identical inputs
	// really does short-circuit, the same way the client memo does for real (see
	// the "Client memo check" step above — same wording, same behaviour).
	//
	// Advances only on click, never on a timer: someone seeing this for the first
	// time needs to actually read a header before it's replaced, not watch it
	// flash past.
	type StageId = 'browser' | 'selva-out' | 'rhino-solve' | 'rhino-answer' | 'selva-in';

	interface Stage {
		id: StageId;
		/** null on the solving stage: nothing travels anywhere while it happens. */
		from: string | null;
		to: string | null;
		/** Which node this dot sits under on the route. */
		at: string;
		title: string;
		explain: string;
		headers: (r: number, c: boolean) => string[];
		body: (r: number, c: boolean) => string;
	}

	// A stand-in "solve": capped halves the area, to give the toggle a visible effect.
	function area(r: number, c: boolean): number {
		const raw = Math.PI * r * r;
		return Math.round((c ? raw * 0.5 : raw) * 10) / 10;
	}

	const STAGES: Stage[] = [
		{
			id: 'browser',
			from: 'Browser',
			to: 'Selva server',
			at: 'Browser',
			title: 'The browser sends what changed',
			explain:
				'You move the slider and the toggle, then hit Solve. The browser packs both current values into one JSON body and POSTs it — this is the only step you triggered directly.',
			headers: () => ['Content-Type: application/json', 'Cookie: admin_session=…'],
			body: (r, c) => `{ "values": { "radius": ${r}, "capped": ${c} } }`
		},
		{
			id: 'selva-out',
			from: 'Selva server',
			to: 'Rhino.Compute',
			at: 'Selva server',
			title: 'Selva repacks it for Rhino',
			explain:
				'Rhino is a .NET program, so a bare value is not enough — each one is wrapped with its parameter name and sent as a small tree, radius and capped both. The server also attaches its own key so Rhino.Compute knows who is asking.',
			headers: () => ['Content-Type: application/json', 'RhinoComputeKey: ••••••'],
			body: (r, c) =>
				`{ "pointer": "md5:7ab3…",\n  "values": [\n    { "ParamName": "radius", "InnerTree": { "{0}": [{ "data": ${r} }] } },\n    { "ParamName": "capped", "InnerTree": { "{0}": [{ "data": ${c} }] } }\n  ] }`
		},
		{
			id: 'rhino-solve',
			from: null,
			to: null,
			at: 'Rhino.Compute',
			title: 'This is where the solve actually happens',
			explain:
				'Nothing travels during this step — Grasshopper is already open and waiting on the Rhino.Compute machine. It plugs radius and capped into the definition, capped picks which branch runs, and the definition recomputes right here. Every earlier step was just getting these two numbers to this machine; every later step is just getting the answer back out.',
			headers: () => [],
			body: () => ''
		},
		{
			id: 'rhino-answer',
			from: 'Rhino.Compute',
			to: 'Selva server',
			at: 'Rhino.Compute',
			title: 'Rhino answers with more detail than it got',
			explain:
				'The solve above just finished. Rhino sends back one small tree per output. Unlike the request, each item now carries its .NET type: Rhino knows exactly what kind of value it produced.',
			headers: () => ['Server-Timing: decode;dur=1, solve;dur=4, encode;dur=1'],
			body: (r, c) =>
				`{ "values": [{ "ParamName": "area", "InnerTree": { "{0}": [{ "type": "System.Double", "data": "${area(r, c)}" }] } }] }`
		},
		{
			id: 'selva-in',
			from: 'Selva server',
			to: 'Browser',
			at: 'Selva server',
			title: 'Selva simplifies it and sends it back',
			explain:
				'The server flattens the tree back into a plain value, times every step it took, and returns both. The bar under the header is that timing, drawn to scale — the browser reads it to show you where the time actually went.',
			headers: () => [
				'Content-Encoding: gzip',
				'X-Selva-Compute-Version: 1',
				'Server-Timing: tree;dur=2, solve;dur=0, rhino_solve;dur=4, total;dur=23'
			],
			body: (r, c) => `{ "outputs": { "area": ${area(r, c)} } }`
		}
	];

	// dur values in ms, shown as a proportional bar — the only thing that never
	// changes with the inputs, since it's illustrating the header format itself.
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

	let radius = $state(12.5);
	let capped = $state(true);
	let started = $state(false);
	let index = $state(0);
	let lastSolved = $state<{ radius: number; capped: boolean } | null>(null);
	let cacheHit = $state(false);

	const stage = $derived(STAGES[index]);
	const isLast = $derived(index === STAGES.length - 1);

	function solve() {
		started = true;
		index = 0;
		cacheHit = lastSolved !== null && lastSolved.radius === radius && lastSolved.capped === capped;
		if (!cacheHit) lastSolved = { radius, capped };
	}

	function next() {
		if (!isLast) index += 1;
	}

	function back() {
		if (index > 0) index -= 1;
	}

	function reset() {
		started = false;
		index = 0;
	}
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-center gap-x-6 gap-y-3">
		<label class="flex min-w-40 flex-1 items-center gap-2 text-xs">
			<span class="text-muted-foreground w-10 shrink-0">radius</span>
			<input
				type="range"
				min="0"
				max="50"
				step="0.5"
				bind:value={radius}
				disabled={started}
				class="accent-primary w-full"
			/>
			<span class="text-foreground w-9 shrink-0 text-right font-mono tabular-nums">{radius}</span>
		</label>
		<label class="flex items-center gap-2 text-xs">
			<span class="text-muted-foreground">capped</span>
			<input
				type="checkbox"
				bind:checked={capped}
				disabled={started}
				class="accent-primary size-3.5"
			/>
		</label>
		{#if !started}
			<button
				class="bg-primary text-primary-foreground ml-auto rounded px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
				onclick={solve}
			>
				Solve
			</button>
		{:else}
			<button
				class="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
				onclick={reset}
			>
				change inputs
			</button>
		{/if}
	</div>

	{#if started && cacheHit}
		<!-- Same radius, same toggle as last time: this is the client memo hit, not a re-walk. -->
		<div class="rounded-md border border-violet-500/30 bg-violet-500/5 p-3">
			<p class="text-sm font-semibold text-violet-600 dark:text-violet-400">
				Same inputs as last time — served from memory
			</p>
			<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">
				radius {radius}, capped {capped}: the browser already has this exact result from before.
				Nothing gets sent — no request leaves the browser, none of the four hops below run, and the
				answer appears instantly.
			</p>
			<pre
				class="text-foreground mt-2.5 overflow-x-auto rounded bg-black/5 p-2 font-mono text-[11px] leading-relaxed dark:bg-white/5">{`{ "outputs": { "area": ${area(radius, capped)} } }`}</pre>
			<p class="text-muted-foreground mt-2 text-[11px]">
				Try a different radius or toggle, then Solve again to see the four hops run for real.
			</p>
		</div>
	{:else if started}
		<!-- The route: one dot per moment, labeled by which node it's happening at.
		     The solve stage sits still on Rhino.Compute — no arrow, so it reads as
		     "this is where time passes", not another hop. -->
		<div class="relative px-1">
			<div class="bg-border absolute top-1.75 right-4 left-4 h-px" aria-hidden="true"></div>
			<div
				class="bg-primary absolute top-1.75 left-4 h-px transition-[width] duration-300 ease-out"
				style="width: {(index / (STAGES.length - 1)) * 100}%"
				aria-hidden="true"
			></div>
			<div class="relative flex justify-between">
				{#each STAGES as s, i (s.id)}
					<div class="flex flex-col items-center gap-1.5" style="width: {100 / STAGES.length}%">
						<span
							class="ring-background size-3.75 rounded-full ring-4 transition-colors {i < index
								? 'bg-emerald-500'
								: i === index
									? s.id === 'rhino-solve'
										? 'animate-pulse bg-orange-500'
										: 'bg-sky-500'
									: 'bg-border'}"
							aria-hidden="true"
						></span>
						<span class="text-muted-foreground max-w-20 text-center text-[10px] leading-tight">
							{s.at}
						</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- The stage being read: plain-language reason first, then the actual bytes. -->
		<div class="border-border bg-muted/30 rounded-md border p-3">
			<div class="flex items-baseline justify-between gap-2">
				<p class="text-sm font-semibold">{stage.title}</p>
				<span class="text-muted-foreground font-mono text-[10px]">
					{#if stage.from}
						{stage.from} → {stage.to}
					{:else}
						solving on {stage.at}
					{/if}
				</span>
			</div>
			<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">{stage.explain}</p>

			{#if stage.id === 'rhino-solve'}
				<div class="border-border/60 mt-3 flex items-center gap-2 border-t pt-2.5">
					<span class="size-2 animate-pulse rounded-full bg-orange-500" aria-hidden="true"></span>
					<span class="text-muted-foreground font-mono text-[11px]">Grasshopper recomputing…</span>
				</div>
			{:else}
				<div class="border-border/60 mt-3 space-y-0.5 border-t pt-2.5">
					{#each stage.headers(radius, capped) as header (header)}
						<p class="text-muted-foreground font-mono text-[11px] leading-relaxed">{header}</p>
					{/each}
				</div>
				<pre
					class="text-foreground mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">{stage.body(
						radius,
						capped
					)}</pre>
			{/if}

			{#if stage.id === 'selva-in'}
				<!-- Server-Timing, decoded: the same seven numbers as the header above, as a bar each. -->
				<div class="border-border/60 mt-3 space-y-1 border-t pt-2.5">
					<p class="text-muted-foreground text-[11px] tracking-wide uppercase">
						that Server-Timing header, one bar per number
					</p>
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
			{/if}
		</div>

		<div class="flex items-center justify-between">
			<button
				class="border-border hover:bg-muted rounded border px-3 py-1.5 text-xs font-medium transition disabled:pointer-events-none disabled:opacity-0"
				onclick={back}
				disabled={index === 0}
			>
				← back
			</button>
			<span class="text-muted-foreground font-mono text-[11px] tabular-nums">
				{index + 1} / {STAGES.length}
			</span>
			{#if !isLast}
				<button
					class="bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
					onclick={next}
				>
					next hop →
				</button>
			{:else}
				<button
					class="border-border hover:bg-muted rounded border px-3 py-1.5 text-xs font-medium transition"
					onclick={reset}
				>
					done — start over
				</button>
			{/if}
		</div>
	{:else}
		<p
			class="text-muted-foreground border-border rounded-md border border-dashed p-6 text-center text-xs italic"
		>
			Set the inputs, then hit Solve. You'll step through each hop yourself — nothing moves until
			you click.
		</p>
	{/if}
</div>
