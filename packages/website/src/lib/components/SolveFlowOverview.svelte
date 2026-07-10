<script lang="ts">
	// The 10-second version of the solve flow. Six big boxes, and the ONE idea
	// that matters most made the visual spine: a solve either HITS the response
	// cache (instant, no network) or MISSES and does the full round-trip to the
	// Rhino.Compute VM. Everything else (the 4 DB reads, cache lifetimes, the
	// gap) lives in the Detail view + the walkthrough — this view is the map, not
	// the manual.

	import type { Mode } from '$lib/architecture';

	interface Props {
		mode: Mode;
	}
	let { mode }: Props = $props();

	// A box on the overview canvas. `tone` drives its accent.
	interface Box {
		id: string;
		x: number;
		y: number;
		w: number;
		h: number;
		title: string;
		body: string;
		tone: 'browser' | 'server' | 'vm' | 'hit' | 'miss';
	}
	interface Edge {
		from: string;
		to: string;
		s: 'r' | 'b' | 'l' | 't';
		t: 'r' | 'b' | 'l' | 't';
		tone: 'flow' | 'hit' | 'miss' | 'response';
		label?: string;
		dash?: boolean;
		/** Override the auto curve strength (control-point offset, px). */
		curveK?: number;
	}

	const W = 1200;
	const H = 700;

	// ---- Cloud overview ----------------------------------------------------
	// One straight left→right spine at a fixed mid-height: Browser → Load →
	// Cache check → Package+return. The cache check FORKS vertically — MISS rises
	// to the Rhino VM (top), HIT drops to the fast path (bottom) — and both
	// branches rejoin at Package+return. A single response arc sweeps back along
	// the very bottom to the browser, so no edges cross.
	const MID = 250; // spine row (box top)
	const CLOUD_BOXES: Box[] = [
		{
			id: 'browser',
			x: 30,
			y: MID,
			w: 210,
			h: 120,
			tone: 'browser',
			title: 'Browser',
			body: 'Slider → debounced + throttled → POST /api/compute'
		},
		{
			id: 'load',
			x: 285,
			y: MID,
			w: 225,
			h: 120,
			tone: 'server',
			title: '1. Load definition',
			body: '4 uncached reads: 3 rows + the .gh blob — every solve'
		},
		{
			id: 'check',
			x: 555,
			y: MID,
			w: 225,
			h: 120,
			tone: 'server',
			title: '2. Response cache?',
			body: 'Same definition + same inputs in the last 5 min?'
		},
		// Fork targets — VM above the spine, HIT below it.
		{
			id: 'vm',
			x: 620,
			y: 40,
			w: 290,
			h: 130,
			tone: 'vm',
			title: 'MISS → Rhino.Compute VM',
			body: 'One HTTPS call over the network. The VM solves (its own decode + solve caches). Takes seconds.'
		},
		{
			id: 'hit',
			x: 620,
			y: 440,
			w: 290,
			h: 120,
			tone: 'hit',
			title: 'HIT → skip everything',
			body: 'Answered from memory — the network and Rhino are never touched. ⚡ ~instant'
		},
		{
			id: 'done',
			x: 960,
			y: MID,
			w: 210,
			h: 120,
			tone: 'server',
			title: '3. Package + return',
			body: 'gzip JSON + Server-Timing → browser renders the meshes'
		}
	];
	const CLOUD_EDGES: Edge[] = [
		{ from: 'browser', to: 'load', s: 'r', t: 'l', tone: 'flow' },
		{ from: 'load', to: 'check', s: 'r', t: 'l', tone: 'flow' },
		// Fork: MISS up to the VM, HIT down to the fast path.
		{ from: 'check', to: 'vm', s: 't', t: 'b', tone: 'miss', label: 'MISS' },
		{ from: 'check', to: 'hit', s: 'b', t: 't', tone: 'hit', label: 'HIT' },
		// Both branches rejoin at Package+return.
		{ from: 'vm', to: 'done', s: 'r', t: 't', tone: 'response' },
		{ from: 'hit', to: 'done', s: 'r', t: 'b', tone: 'response' },
		// One clean return arc along the bottom.
		{
			from: 'done',
			to: 'browser',
			s: 'b',
			t: 'b',
			tone: 'response',
			label: 'result → browser',
			curveK: 360
		}
	];

	// ---- Local overview ----------------------------------------------------
	const LOCAL_BOXES: Box[] = [
		{
			id: 'browser',
			x: 120,
			y: 200,
			w: 260,
			h: 130,
			tone: 'browser',
			title: 'Browser',
			body: 'Slider moves → batched values sent over one WebSocket'
		},
		{
			id: 'gh',
			x: 620,
			y: 90,
			w: 280,
			h: 130,
			tone: 'vm',
			title: 'Grasshopper (in Rhino)',
			body: 'The definition is already open. It re-solves the live document in-process.'
		},
		{
			id: 'render',
			x: 620,
			y: 360,
			w: 280,
			h: 110,
			tone: 'server',
			title: 'Results push back',
			body: 'JSON + binary mesh frames → browser renders. No server, no caches.'
		}
	];
	const LOCAL_EDGES: Edge[] = [
		{ from: 'browser', to: 'gh', s: 'r', t: 'l', tone: 'flow', label: 'WebSocket :8765' },
		{ from: 'gh', to: 'render', s: 'b', t: 't', tone: 'flow' },
		{ from: 'render', to: 'browser', s: 'l', t: 'b', tone: 'response', label: 'push' }
	];

	const boxes = $derived(mode === 'cloud' ? CLOUD_BOXES : LOCAL_BOXES);
	const edges = $derived(mode === 'cloud' ? CLOUD_EDGES : LOCAL_EDGES);

	const TONE: Record<Box['tone'], { border: string; bg: string; title: string }> = {
		browser: {
			border: 'border-sky-500/50',
			bg: 'bg-sky-500/[0.07]',
			title: 'text-sky-600 dark:text-sky-300'
		},
		server: {
			border: 'border-emerald-500/50',
			bg: 'bg-emerald-500/[0.07]',
			title: 'text-emerald-600 dark:text-emerald-300'
		},
		vm: {
			border: 'border-orange-500/50',
			bg: 'bg-orange-500/[0.07]',
			title: 'text-orange-600 dark:text-orange-300'
		},
		hit: {
			border: 'border-violet-500/60',
			bg: 'bg-violet-500/[0.1]',
			title: 'text-violet-600 dark:text-violet-300'
		},
		miss: { border: 'border-primary/50', bg: 'bg-primary/[0.07]', title: 'text-primary' }
	};

	const EDGE_STROKE: Record<Edge['tone'], string> = {
		flow: 'var(--color-primary)',
		hit: '#8b5cf6', // violet — the fast path
		miss: '#f97316', // orange — the expensive path to the VM
		response: '#0ea5e9'
	};

	function anchor(b: Box, side: 'r' | 'b' | 'l' | 't'): [number, number] {
		switch (side) {
			case 'r':
				return [b.x + b.w, b.y + b.h / 2];
			case 'l':
				return [b.x, b.y + b.h / 2];
			case 't':
				return [b.x + b.w / 2, b.y];
			case 'b':
				return [b.x + b.w / 2, b.y + b.h];
		}
	}
	const DIR: Record<'r' | 'b' | 'l' | 't', [number, number]> = {
		r: [1, 0],
		l: [-1, 0],
		t: [0, -1],
		b: [0, 1]
	};
	function box(id: string): Box {
		return boxes.find((b) => b.id === id)!;
	}
	function path(e: Edge): string {
		const [sx, sy] = anchor(box(e.from), e.s);
		const [tx, ty] = anchor(box(e.to), e.t);
		const k = e.curveK ?? Math.min(Math.max(Math.hypot(tx - sx, ty - sy) / 2.2, 40), 120);
		const c1x = sx + DIR[e.s][0] * k;
		const c1y = sy + DIR[e.s][1] * k;
		const c2x = tx + DIR[e.t][0] * k;
		const c2y = ty + DIR[e.t][1] * k;
		return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
	}
	function labelPos(e: Edge): [number, number] {
		const [sx, sy] = anchor(box(e.from), e.s);
		const [tx, ty] = anchor(box(e.to), e.t);
		// A bottom→bottom arc (the return path) dips below both endpoints. Put its
		// label on the LEFT third of the arc — clear of the HIT box on the right —
		// down where the arc actually runs.
		if (e.s === 'b' && e.t === 'b') {
			const dip = Math.max(sy, ty) + (e.curveK ?? 120) * 0.66;
			return [Math.min(sx, tx) + Math.abs(tx - sx) * 0.3, dip];
		}
		return [(sx + tx) / 2, (sy + ty) / 2];
	}
</script>

<div class="border-border bg-card/40 overflow-x-auto rounded-xl border">
	<div class="relative mx-auto" style="width: {W}px; height: {H}px;">
		<svg class="pointer-events-none absolute inset-0" width={W} height={H} aria-hidden="true">
			<defs>
				{#each ['flow', 'hit', 'miss', 'response'] as const as tone (tone)}
					<marker
						id="ov-arr-{tone}"
						markerWidth="8"
						markerHeight="8"
						refX="6"
						refY="4"
						orient="auto"
					>
						<path d="M0,0 L8,4 L0,8 Z" fill={EDGE_STROKE[tone]} />
					</marker>
				{/each}
			</defs>
			{#each edges as e (e.from + e.to)}
				<path
					d={path(e)}
					fill="none"
					stroke={EDGE_STROKE[e.tone]}
					stroke-width={e.tone === 'hit' || e.tone === 'miss' ? 3 : 2.5}
					stroke-opacity="0.9"
					marker-end="url(#ov-arr-{e.tone})"
					class={e.tone === 'response' ? 'ov-response' : 'ov-flow'}
				/>
				{#if e.label}
					{@const [lx, ly] = labelPos(e)}
					<text
						x={lx}
						y={ly - 9}
						text-anchor="middle"
						fill={e.tone === 'flow' || e.tone === 'response'
							? 'var(--color-foreground)'
							: EDGE_STROKE[e.tone]}
						class="text-[13px] font-bold"
						style="paint-order: stroke; stroke: var(--color-background); stroke-width: 4px;"
						>{e.label}</text
					>
				{/if}
			{/each}
		</svg>

		{#each boxes as b (b.id)}
			<div
				class="absolute rounded-xl border-2 p-4 shadow-sm {TONE[b.tone].border} {TONE[b.tone].bg}"
				style="left: {b.x}px; top: {b.y}px; width: {b.w}px; height: {b.h}px;"
			>
				<div class="text-[15px] font-bold {TONE[b.tone].title}">{b.title}</div>
				<div class="text-muted-foreground mt-1.5 text-[13px] leading-snug">{b.body}</div>
			</div>
		{/each}
	</div>
</div>

<!-- Legend -->
<div class="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
	{#if mode === 'cloud'}
		<span class="flex items-center gap-1.5">
			<svg width="22" height="6"
				><line x1="0" y1="3" x2="22" y2="3" stroke="#8b5cf6" stroke-width="3" /></svg
			>
			cache HIT — instant, no network
		</span>
		<span class="flex items-center gap-1.5">
			<svg width="22" height="6"
				><line x1="0" y1="3" x2="22" y2="3" stroke="#f97316" stroke-width="3" /></svg
			>
			cache MISS — full round-trip to Rhino
		</span>
	{/if}
	<span class="flex items-center gap-1.5">
		<svg width="22" height="6"
			><line x1="0" y1="3" x2="22" y2="3" stroke="#0ea5e9" stroke-width="2.5" /></svg
		>
		result back to the browser
	</span>
	<span class="ml-auto hidden sm:inline">switch to Detail for the full picture ↑</span>
</div>

<style>
	.ov-flow {
		stroke-dasharray: 8 7;
		animation: ov-dash 0.9s linear infinite;
	}
	.ov-response {
		stroke-dasharray: 8 7;
		animation: ov-dash 0.9s linear infinite;
	}
	@keyframes ov-dash {
		to {
			stroke-dashoffset: -15;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.ov-flow,
		.ov-response {
			animation: none;
		}
	}
</style>
