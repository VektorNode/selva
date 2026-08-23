<script lang="ts">
	// The local-mode counterpart to SolveWalkthrough: the same solve, but as the
	// frames that cross one WebSocket. There is no request/response pairing here,
	// so the interesting shape is not "what did each hop do to the body" but "what
	// is a frame, and how do the binary ones find the envelope that describes them".
	interface Frame {
		/** null on the solve itself: nothing travels while it happens. */
		from: string | null;
		to: string | null;
		at: string;
		/** JSON envelope or opaque binary — drives how the payload is rendered. */
		kind: 'json' | 'binary' | 'none';
		title: string;
		explain: string;
		payload: string;
		/** What the receiving side does before the next frame matters. */
		transform: string | null;
	}

	const FRAMES: Frame[] = [
		{
			from: 'Browser',
			to: 'Grasshopper',
			at: 'Browser',
			kind: 'json',
			title: 'The browser sends what changed',
			explain:
				'One frame, both values, addressed by input id. No method, no path, no cookie — the socket is already open and already belongs to this session. File metadata is stripped first: Grasshopper holds the file, so re-sending it would be pointless.',
			payload: `{
  "type": "valueUpdate",
  "sessionId": "a3f1…",
  "values": { "radius": 12.5, "capped": true }
}`,
			transform: null
		},
		{
			from: null,
			to: null,
			at: 'Grasshopper',
			kind: 'none',
			title: 'The solve happens here',
			explain:
				'Nothing travels. The values are written into the linked parameters and the open document re-solves right there in Rhino. Everything the cloud path does to get a definition onto a machine that can solve it — pointers, uploads, a compute server — has no equivalent: the definition is already open in Rhino.',
			payload: '',
			transform: null
		},
		{
			from: 'Grasshopper',
			to: 'Browser',
			at: 'Grasshopper',
			kind: 'json',
			title: 'A summary message announces the results',
			explain:
				'The numeric outputs ride this message directly. Meshes do not — binaryBatchCount says how many mesh messages are following, so the browser knows to wait rather than render a half-empty scene. Curves and points arrive here too, already converted to plain line segments by the plugin.',
			payload: `{
  "type": "outputs",
  "sessionId": "a3f1…",
  "outputs": { "area": 490.9 },
  "binaryBatchCount": 2,
  "modelUnits": "Millimeters"
}`,
			transform: 'the browser now waits for exactly 2 binary frames'
		},
		{
			from: 'Grasshopper',
			to: 'Browser',
			at: 'Grasshopper',
			kind: 'binary',
			title: 'Then the meshes, as raw bytes',
			explain:
				'Two separate socket messages, one per material group. They carry raw bytes rather than JSON, so the mesh data travels as-is — the cloud path has to encode the same bytes as text to fit them in a response body, which makes them a third larger.',
			payload: `SLVA · v1 · [JSON metadata][compressed geometry]
frame 1 of 2 — 41 KB
frame 2 of 2 — 12 KB`,
			transform: 'count reached — parse, scale to model units, hand to the viewer'
		}
	];

	// The two ordering hazards a push transport has and a request/response one does
	// not. Both are real handling in websocket-solve-driver.ts, not hypotheticals.
	const HAZARDS = [
		{
			case: 'A mesh arrives before the summary that describes it',
			handling:
				'It is held in a small fixed-size buffer, at most 64 messages. The next summary picks up whatever is waiting, so an early mesh is not lost and a flood cannot grow without bound.'
		},
		{
			case: 'A newer solve lands while the old one is still being read',
			handling:
				'Each set of results is numbered as it arrives. Reading the meshes takes time, and finished meshes are only drawn if nothing newer has arrived meanwhile — so slow old geometry can never overwrite what is on screen.'
		},
		{
			case: 'Two value updates in quick succession',
			handling:
				'Merged. While Grasshopper is solving the batch waits in a single pending slot that a newer update overwrites, so the socket never queues a backlog of superseded values.'
		}
	];
</script>

<div class="space-y-3">
	{#each FRAMES as frame, i (frame.at + frame.title)}
		{#if frame.transform}
			<div class="text-muted-foreground flex items-center gap-2 pl-3 text-[11px] italic">
				<span aria-hidden="true">↓</span>
				{frame.transform}
			</div>
		{/if}

		<div
			class="rounded-md border p-3 {frame.kind === 'none'
				? 'border-orange-500/30 bg-orange-500/5'
				: 'border-border bg-muted/30'}"
		>
			<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
				<p class="text-sm font-semibold">
					<span class="text-muted-foreground mr-1.5 font-mono text-[11px] tabular-nums"
						>{i + 1}</span
					>{frame.title}
				</p>
				<span class="text-muted-foreground font-mono text-[10px]">
					{#if frame.from}
						{frame.from} → {frame.to}
					{:else}
						on {frame.at}
					{/if}
				</span>
			</div>
			<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">{frame.explain}</p>

			{#if frame.payload}
				<div class="border-border/60 mt-3 flex items-center gap-2 border-t pt-2.5">
					<span
						class="rounded px-1.5 py-0.5 font-mono text-[10px] {frame.kind === 'binary'
							? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
							: 'bg-sky-500/10 text-sky-600 dark:text-sky-400'}"
					>
						{frame.kind === 'binary' ? 'binary frame' : 'text frame'}
					</span>
				</div>
				<pre
					class="text-foreground mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed">{frame.payload}</pre>
			{/if}
		</div>
	{/each}

	<!-- What a push transport has to handle that a request/response one gets for free. -->
	<div class="border-border bg-muted/30 rounded-md border p-3">
		<p class="text-sm font-semibold">What can arrive out of order</p>
		<p class="text-muted-foreground mt-1.5 text-xs leading-relaxed">
			Nothing pairs a reply to a request here, and nothing can be cancelled — a newer value simply
			supersedes an older one. That buys low latency and costs three pieces of ordering logic.
		</p>
		<dl class="border-border divide-border mt-3 divide-y rounded-md border">
			{#each HAZARDS as h (h.case)}
				<div class="px-3 py-2.5">
					<dt class="text-xs font-semibold">{h.case}</dt>
					<dd class="text-muted-foreground mt-1 text-xs leading-relaxed">{h.handling}</dd>
				</div>
			{/each}
		</dl>
	</div>
</div>
