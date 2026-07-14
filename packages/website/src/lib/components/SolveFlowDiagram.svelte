<script lang="ts">
	// Machine-oriented flow graph. THREE machines across a network:
	//   Browser · Selva server · Rhino.Compute VM.
	// The @selvajs/compute client (warm client, scheduler, its caches) is NOT a
	// fourth machine — it's a library that runs INSIDE the Selva server process,
	// so it's drawn as a nested "in-process" frame within the server column.
	// Solid network edges carry a protocol label; the in-process call from the
	// server's policy code into the compute library is an ordinary function call.
	//
	// Node content (titles, cache chips) comes from $lib/architecture so the graph
	// and the detail panel below can never drift apart.

	import {
		CLOUD_STEPS,
		LOCAL_STEPS,
		CACHES,
		LAYERS,
		type Mode,
		type Provider,
		type Layer,
		type FlowStep
	} from '$lib/architecture';

	interface Props {
		mode: Mode;
		provider: Provider;
		selected: string | null;
		onselect: (id: string | null) => void;
	}

	let { mode, provider, selected, onselect }: Props = $props();

	// ------------------------------------------------------------------
	// Column grid — sub-lanes, grouped into machine frames
	// ------------------------------------------------------------------
	//
	// Columns are the fine grid the nodes sit on; MACHINES group ranges of
	// columns into the boxes that actually represent hardware. The Selva server
	// spans two columns: policy code (col 1) + the in-process compute library
	// (col 2). Browser is col 0, the VM is col 3.

	const COL_W = 296;
	const COL_GAP = 22;
	const NODE_W = 260;
	// Extra horizontal gap between two adjacent MACHINES (on top of COL_GAP) so a
	// network hop and its protocol-label pill fit fully within the boundary gap.
	const MACHINE_GAP = 150;

	const TOP = 84; // machine header + top padding
	const GAP_Y = 34; // vertical gap between stacked cards in a column
	const ROW_H = 118; // legacy row pitch — still used to seed anchor rows

	interface NodeDef {
		col: number;
		row: number;
		h: number;
		sub?: string;
		/** Pin this node's TOP to a target y (used to align cross-column handoffs). */
		pinY?: number;
	}
	interface NodePos extends NodeDef {
		y: number;
	}

	function rowY(row: number): number {
		return TOP + row * ROW_H;
	}

	// Flow layout: within each column, stack cards top-down with a uniform GAP_Y
	// so a taller card (the 4-call "Load the definition") simply pushes the ones
	// below it — no overlaps, even rhythm. A node may pin its top to a specific y
	// (rowY of some row) to align a cross-column handoff; nodes without a pin flow
	// from wherever the previous card in their column ended.
	function place(defs: Record<string, NodeDef>): Record<string, NodePos> {
		const out: Record<string, NodePos> = {};
		const byCol: Record<number, [string, NodeDef][]> = {};
		for (const entry of Object.entries(defs)) {
			(byCol[entry[1].col] ??= []).push(entry);
		}
		for (const list of Object.values(byCol)) {
			// Order by intended row so flow direction follows the request order.
			list.sort((a, b) => a[1].row - b[1].row);
			let cursor = TOP;
			for (const [id, d] of list) {
				const top = Math.max(d.pinY ?? rowY(d.row), cursor);
				out[id] = { ...d, y: top };
				cursor = top + d.h + GAP_Y;
			}
		}
		return out;
	}

	// CLOUD — request descends the browser col, hops the network into the server
	// (policy col), calls in-process into the compute library (its own col), which
	// makes the one outbound network call to the VM; the response returns.
	const CLOUD_DEF: Record<string, NodeDef> = {
		// Browser (col 0)
		'b-input': { col: 0, row: 0, h: 64, sub: 'debounce 150 / 400 ms' },
		'b-throttle': { col: 0, row: 1, h: 64, sub: '1 in flight · latest wins' },
		'b-post': { col: 0, row: 2, h: 64, sub: '{ inputs, values, definitionUrl }' },
		'b-render': { col: 0, row: 7, h: 88, pinY: rowY(7), sub: 'meshes → three.js viewer' },
		// Selva server — policy code (col 1). Flows top-down; s-load is tall (4
		// calls) and pushes the rest down.
		's-gates': { col: 1, row: 0, h: 64, sub: 'size cap · auth · rate limit' },
		's-load': { col: 1, row: 1, h: 232, sub: '' },
		's-resolve': { col: 1, row: 2, h: 64, sub: 'pin → org → global default' },
		's-warm': { col: 1, row: 3, h: 80, sub: 'ready client — no handshake' },
		'p-tree': { col: 1, row: 4, h: 64, sub: 'values → GH data tree' },
		'p-out': { col: 1, row: 7, h: 64, pinY: rowY(7), sub: 'size-guard · gzip · Server-Timing' },
		// Selva server — @selvajs/compute library, in-process (col 2). Pinned so
		// c-cache lines up with p-tree's handoff.
		'c-cache': { col: 2, row: 4, h: 120, pinY: rowY(5), sub: 'L2 (if on) + 5-min response cache' },
		'c-pointer': { col: 2, row: 5, h: 84, sub: 'md5 pointer or re-upload' },
		'c-http': { col: 2, row: 7, h: 64, pinY: rowY(7), sub: 'auth · retry · abort rides along' },
		// Rhino.Compute VM (col 3)
		'r-solve': { col: 3, row: 7, h: 100, pinY: rowY(7), sub: '' }
	};

	const LOCAL_DEF: Record<string, NodeDef> = {
		'l-input': { col: 0, row: 0, h: 64, sub: '50 ms batch · latest wins' },
		'l-ws': { col: 0, row: 1, h: 64, sub: 'ws://localhost:8765 · push, no auth' },
		'l-render': { col: 0, row: 3, h: 88, sub: 'meshes → three.js viewer' },
		'l-solve': { col: 1, row: 1, h: 64, sub: 'live document — no upload, no parse' },
		'l-push': { col: 1, row: 2, h: 64, sub: 'JSON outputs + binary mesh frames' }
	};

	const CLOUD_POS = place(CLOUD_DEF);
	const LOCAL_POS = place(LOCAL_DEF);

	// Machine frames — the hardware boxes. `cols` is the inclusive column range.
	// `nested` frames draw a sub-box inside a machine (the in-process library).
	interface MachineFrame {
		id: string;
		label: string;
		sub: string;
		layer: Layer;
		cols: [number, number];
	}
	interface NestedFrame {
		label: string;
		sub: string;
		cols: [number, number];
		/** row range the nested box should span (top row .. bottom row). */
		rows: [number, number];
	}

	const CLOUD_MACHINES: MachineFrame[] = [
		{ id: 'm-browser', label: 'Browser', sub: 'the user’s tab', layer: 'browser', cols: [0, 0] },
		{
			id: 'm-server',
			label: 'Selva server',
			sub: 'SvelteKit app + @selvajs/compute (one process)',
			layer: 'selva-server',
			cols: [1, 2]
		},
		{
			id: 'm-vm',
			label: 'Rhino.Compute VM',
			sub: 'headless Rhino',
			layer: 'rhino',
			cols: [3, 3]
		}
	];
	const CLOUD_NESTED: NestedFrame[] = [
		{
			label: '@selvajs/compute',
			sub: 'runs in-process — a library, not a service',
			cols: [2, 2],
			rows: [4, 6]
		}
	];

	const LOCAL_MACHINES: MachineFrame[] = [
		{ id: 'm-browser', label: 'Browser', sub: 'the user’s tab', layer: 'browser', cols: [0, 0] },
		{
			id: 'm-gh',
			label: 'Grasshopper',
			sub: 'live document in Rhino, via the Selva plugin',
			layer: 'grasshopper',
			cols: [1, 1]
		}
	];

	type Side = 'top' | 'bottom' | 'left' | 'right';

	interface EdgeDef {
		from: string;
		to: string;
		kind: 'main' | 'response' | 'hit';
		s?: Side;
		t?: Side;
		label?: string;
		labelDx?: number;
		labelDy?: number;
		curveK?: number;
		/** A network hop — drawn solid (not dashed) with a protocol label. */
		network?: boolean;
	}

	const CLOUD_EDGES: EdgeDef[] = [
		// Browser: down the column.
		{ from: 'b-input', to: 'b-throttle', kind: 'main' },
		{ from: 'b-throttle', to: 'b-post', kind: 'main' },
		// NETWORK HOP #1 — browser → server.
		{
			from: 'b-post',
			to: 's-gates',
			kind: 'main',
			s: 'right',
			t: 'left',
			network: true,
			label: 'HTTPS · POST /api/compute'
		},
		// Server policy code: down the column.
		{ from: 's-gates', to: 's-load', kind: 'main' },
		{ from: 's-load', to: 's-resolve', kind: 'main' },
		{ from: 's-resolve', to: 's-warm', kind: 'main' },
		{ from: 's-warm', to: 'p-tree', kind: 'main' },
		// IN-PROCESS call into the compute library (function call, no protocol).
		{ from: 'p-tree', to: 'c-cache', kind: 'main', s: 'right', t: 'left' },
		{ from: 'c-cache', to: 'c-pointer', kind: 'main', label: 'miss' },
		{ from: 'c-pointer', to: 'c-http', kind: 'main' },
		// NETWORK HOP #2 — the server’s only outbound call, compute lib → VM.
		{
			from: 'c-http',
			to: 'r-solve',
			kind: 'main',
			s: 'right',
			t: 'left',
			network: true,
			label: 'HTTPS · POST /grasshopper'
		},
		// Response returns: VM → server (package) → browser (render).
		{
			from: 'r-solve',
			to: 'p-out',
			kind: 'response',
			s: 'bottom',
			t: 'bottom',
			label: 'gzip JSON result',
			curveK: 60,
			network: true
		},
		{ from: 'p-out', to: 'b-render', kind: 'response', s: 'left', t: 'right', network: true },
		// Cache-hit shortcut: the in-process response cache answers without the
		// network hop to the VM.
		{
			from: 'c-cache',
			to: 'p-out',
			kind: 'hit',
			s: 'left',
			t: 'top',
			label: 'HIT — compute never called',
			labelDx: -60,
			labelDy: 8
		}
	];

	const LOCAL_EDGES: EdgeDef[] = [
		{ from: 'l-input', to: 'l-ws', kind: 'main' },
		{
			from: 'l-ws',
			to: 'l-solve',
			kind: 'main',
			s: 'right',
			t: 'top',
			network: true,
			label: 'WebSocket :8765',
			labelDx: -60,
			labelDy: -14
		},
		{ from: 'l-solve', to: 'l-push', kind: 'main' },
		{
			from: 'l-push',
			to: 'l-render',
			kind: 'response',
			s: 'left',
			t: 'top',
			label: 'binary mesh frames',
			network: true
		}
	];

	// Per-machine tint (fill) + border color, keyed by layer.
	const MACHINE_STYLE: Record<Layer, { fill: string; border: string }> = {
		browser: { fill: 'rgb(14 165 233 / 0.05)', border: 'rgb(14 165 233 / 0.35)' },
		'selva-server': { fill: 'rgb(16 185 129 / 0.05)', border: 'rgb(16 185 129 / 0.35)' },
		'compute-client': { fill: 'rgb(6 182 212 / 0.05)', border: 'rgb(6 182 212 / 0.35)' },
		rhino: { fill: 'rgb(249 115 22 / 0.05)', border: 'rgb(249 115 22 / 0.35)' },
		grasshopper: { fill: 'rgb(249 115 22 / 0.05)', border: 'rgb(249 115 22 / 0.35)' }
	};

	const machines = $derived(mode === 'cloud' ? CLOUD_MACHINES : LOCAL_MACHINES);
	const nested = $derived(mode === 'cloud' ? CLOUD_NESTED : []);
	const pos = $derived(mode === 'cloud' ? CLOUD_POS : LOCAL_POS);
	const edges = $derived(mode === 'cloud' ? CLOUD_EDGES : LOCAL_EDGES);
	const steps = $derived(mode === 'cloud' ? CLOUD_STEPS : LOCAL_STEPS);

	const colCount = $derived(mode === 'cloud' ? 4 : 2);

	// First column index of each machine — a boundary before these cols gets the
	// wider MACHINE_GAP instead of COL_GAP.
	const machineStartCols = $derived(new Set(machines.map((m) => m.cols[0])));

	/** Left x of a column, adding MACHINE_GAP at each machine boundary. */
	function colX(i: number): number {
		let x = COL_GAP;
		for (let c = 0; c < i; c++) {
			x += COL_W + (machineStartCols.has(c + 1) ? MACHINE_GAP : COL_GAP);
		}
		return x;
	}

	const width = $derived(colX(colCount - 1) + COL_W + COL_GAP);
	const height = $derived(Math.max(...Object.values(pos).map((p) => p.y + p.h)) + 96);
	function nodeX(p: NodePos): number {
		return colX(p.col) + (COL_W - NODE_W) / 2;
	}

	// Machine/nested frame geometry (a padded box around a column range).
	const FRAME_PAD = 10;
	function frameBox(cols: [number, number]) {
		const left = colX(cols[0]) - FRAME_PAD;
		const right = colX(cols[1]) + COL_W + FRAME_PAD;
		return { left, width: right - left };
	}
	function nestedBox(f: NestedFrame) {
		const { left, width: w } = frameBox(f.cols);
		const top = rowY(f.rows[0]) - 30;
		// bottom = deepest node in the range + its height + pad
		const bottomRowY = rowY(f.rows[1]);
		const maxH = Math.max(
			...Object.values(pos)
				.filter((p) => p.col >= f.cols[0] && p.col <= f.cols[1] && p.y === bottomRowY)
				.map((p) => p.h),
			64
		);
		return { left, width: w, top, height: bottomRowY + maxH + 16 - top };
	}

	function anchor(id: string, side: Side): [number, number] {
		const p = pos[id];
		const x = nodeX(p);
		switch (side) {
			case 'top':
				return [x + NODE_W / 2, p.y];
			case 'bottom':
				return [x + NODE_W / 2, p.y + p.h];
			case 'left':
				return [x, p.y + p.h / 2];
			case 'right':
				return [x + NODE_W, p.y + p.h / 2];
		}
	}

	const DIR: Record<Side, [number, number]> = {
		top: [0, -1],
		bottom: [0, 1],
		left: [-1, 0],
		right: [1, 0]
	};

	function edgePath(e: EdgeDef): string {
		const sSide = e.s ?? 'bottom';
		const tSide = e.t ?? 'top';
		const [sx, sy] = anchor(e.from, sSide);
		const [tx, ty] = anchor(e.to, tSide);
		const dist = Math.hypot(tx - sx, ty - sy);
		const k = e.curveK ?? Math.min(Math.max(dist / 2.2, 36), 140);
		const c1x = sx + DIR[sSide][0] * k;
		const c1y = sy + DIR[sSide][1] * k;
		const c2x = tx + DIR[tSide][0] * k;
		const c2y = ty + DIR[tSide][1] * k;
		return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
	}

	function edgeMid(e: EdgeDef): [number, number] {
		const [sx, sy] = anchor(e.from, e.s ?? 'bottom');
		const [tx, ty] = anchor(e.to, e.t ?? 'top');
		return [(sx + tx) / 2, (sy + ty) / 2];
	}

	/**
	 * Label anchor for a network hop. For a left↔right hop across a machine gap we
	 * want the pill centered in the GAP (mid-x of the two anchors) at the source
	 * anchor's height, not on the curved path's geometric midpoint (which can ride
	 * up over a node). Falls back to the plain midpoint otherwise.
	 */
	function networkLabelPos(e: EdgeDef): [number, number] {
		const sSide = e.s ?? 'bottom';
		const tSide = e.t ?? 'top';
		const [sx, sy] = anchor(e.from, sSide);
		const [tx, ty] = anchor(e.to, tSide);
		const horizontal =
			(sSide === 'right' || sSide === 'left') && (tSide === 'left' || tSide === 'right');
		// Centered in the gap, lifted just above the line's midpoint.
		if (horizontal) return [(sx + tx) / 2, (sy + ty) / 2 - 13];
		return [(sx + tx) / 2, (sy + ty) / 2];
	}

	const EDGE_COLOR: Record<EdgeDef['kind'], string> = {
		main: 'var(--color-primary)',
		response: '#0ea5e9',
		hit: '#8b5cf6'
	};

	function stepById(id: string): FlowStep | undefined {
		return steps.find((s) => s.id === id);
	}
	function cacheName(id: string): string {
		return CACHES.find((c) => c.id === id)?.name ?? id;
	}
	function cacheLifetime(id: string): string {
		return CACHES.find((c) => c.id === id)?.lifetime ?? '';
	}

	// Call-tag colors by kind (DB read / storage fetch / network).
	const CALL_STYLE: Record<'db' | 'storage' | 'network', string> = {
		db: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
		storage: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
		network: 'border-primary/30 bg-primary/10 text-primary'
	};

	// Rewrite a call's target for the active provider — the base data uses the
	// Supabase wording; local-files mode swaps it so the diagram stays truthful.
	function callTarget(target: string): string {
		if (provider === 'supabase') return target;
		if (target.startsWith('Postgres')) return 'JSON file on disk';
		if (target.startsWith('Supabase storage')) return 'blob on disk';
		return target;
	}
</script>

<div class="border-border bg-card/40 overflow-x-auto rounded-xl border">
	<div class="relative mx-auto" style="width: {width}px; height: {height}px;">
		<!-- Machine frames (the hardware boxes) -->
		{#each machines as m (m.id)}
			{@const box = frameBox(m.cols)}
			<div
				class="absolute top-0 bottom-0 rounded-xl border"
				style="left: {box.left}px; width: {box.width}px; background: {MACHINE_STYLE[m.layer]
					.fill}; border-color: {MACHINE_STYLE[m.layer].border};"
				aria-hidden="true"
			></div>
			<div
				class="absolute top-4 flex items-center gap-2 overflow-hidden px-5"
				style="left: {box.left}px; width: {box.width}px;"
			>
				<span class="size-2.5 shrink-0 rounded-full {LAYERS[m.layer].dot}" aria-hidden="true"
				></span>
				<span class="text-sm font-semibold whitespace-nowrap">{m.label}</span>
				<span class="text-muted-foreground truncate text-xs whitespace-nowrap">· {m.sub}</span>
			</div>
		{/each}

		<!-- Nested in-process frame (the compute library inside the server) -->
		{#each nested as f (f.label)}
			{@const box = nestedBox(f)}
			<div
				class="absolute rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/4"
				style="left: {box.left}px; top: {box.top}px; width: {box.width}px; height: {box.height}px;"
				aria-hidden="true"
			></div>
			<div
				class="absolute flex items-center gap-1.5 px-3"
				style="left: {box.left}px; top: {box.top + 6}px; width: {box.width}px;"
			>
				<span class="font-mono text-[11px] font-semibold text-cyan-600 dark:text-cyan-400"
					>{f.label}</span
				>
				<span class="text-muted-foreground truncate text-[10px]">· {f.sub}</span>
			</div>
		{/each}

		<!-- Edges -->
		<svg class="pointer-events-none absolute inset-0" {width} {height} aria-hidden="true">
			<defs>
				<marker id="arr-main" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
					<path d="M0,0 L7,3.5 L0,7 Z" fill="var(--color-primary)" />
				</marker>
				<marker
					id="arr-response"
					markerWidth="7"
					markerHeight="7"
					refX="5.5"
					refY="3.5"
					orient="auto"
				>
					<path d="M0,0 L7,3.5 L0,7 Z" fill="#0ea5e9" />
				</marker>
				<marker id="arr-hit" markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
					<path d="M0,0 L7,3.5 L0,7 Z" fill="#8b5cf6" />
				</marker>
			</defs>
			{#each edges as e (e.from + e.to)}
				<path
					d={edgePath(e)}
					fill="none"
					stroke={EDGE_COLOR[e.kind]}
					stroke-width={e.kind === 'hit' ? 1.5 : e.network ? 2.5 : 2}
					stroke-opacity={e.kind === 'hit' ? 0.75 : 0.9}
					marker-end="url(#arr-{e.kind})"
					class={e.kind === 'hit' ? 'edge-hit' : e.network ? 'edge-network' : 'edge-flow'}
				/>
				{#if e.label && !e.network}
					{@const [mx, my] = edgeMid(e)}
					<text
						x={mx + (e.labelDx ?? 0)}
						y={my - 7 + (e.labelDy ?? 0)}
						text-anchor="middle"
						class="fill-(--color-muted-foreground) text-[10px]"
						style="paint-order: stroke; stroke: var(--color-background); stroke-width: 3.5px;"
						>{e.label}</text
					>
				{/if}
			{/each}
		</svg>

		<!-- Network-hop protocol labels — HTML pills so they never clip and read as
		     "this is the wire / the protocol". Centered on the edge midpoint. -->
		{#each edges as e (e.from + e.to)}
			{#if e.label && e.network}
				{@const [mx, my] = networkLabelPos(e)}
				<div
					class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap shadow-sm
						{e.kind === 'response'
						? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
						: 'border-primary/40 bg-card text-foreground'}"
					style="left: {mx + (e.labelDx ?? 0)}px; top: {my + (e.labelDy ?? 0)}px;"
				>
					{e.label}
				</div>
			{/if}
		{/each}

		<!-- Nodes -->
		{#each Object.entries(pos) as [id, p] (mode + id)}
			{@const step = stepById(id)}
			{#if step}
				<button
					class="border-border bg-card absolute rounded-lg border px-3 py-2 text-left shadow-sm transition
						hover:border-(--color-muted-foreground)
						{selected === id ? 'ring-primary ring-2' : ''}"
					style="left: {nodeX(p)}px; top: {p.y}px; width: {NODE_W}px; min-height: {p.h}px;"
					aria-pressed={selected === id}
					onclick={() => onselect(selected === id ? null : id)}
				>
					<div class="text-[13px] leading-tight font-semibold">{step.title}</div>
					{#if id === 'r-solve'}
						<div class="mt-1.5 space-y-1">
							<div
								class="flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-400"
							>
								<span class="size-1 rounded-full bg-violet-500"></span> definition cache — decode ≈ 0
								ms on hit
							</div>
							<div
								class="flex items-center gap-1.5 rounded border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-400"
							>
								<span class="size-1 rounded-full bg-violet-500"></span> cachesolve — solve ≈ 0 ms on hit
							</div>
							<div class="text-muted-foreground text-[11px]">else: headless Grasshopper solves</div>
						</div>
					{:else}
						{#if p.sub}
							<div class="text-muted-foreground mt-0.5 font-mono text-[10.5px] leading-snug">
								{p.sub}
							</div>
						{/if}
						{#if step.calls}
							<!-- The discrete backend calls this step makes, numbered so the true
							     round-trip count is visible, each tagged with WHERE it goes and
							     whether it's cached (the three rows are uncached; the .gh blob is
							     now lazy + byte-cached, skipped on a pointer solve). -->
							<ol class="mt-1.5 space-y-1">
								{#each step.calls as call, i (call.name)}
									<li class="text-[10px] leading-tight">
										<div class="flex items-center gap-1.5">
											<span class="text-muted-foreground tabular-nums">{i + 1}.</span>
											<span class="rounded border px-1 py-px font-mono {CALL_STYLE[call.kind]}"
												>{call.name}</span
											>
											<span
												class="rounded px-1 py-px text-[9px] font-medium tracking-wide uppercase {call.cached ===
												'uncached'
													? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
													: 'bg-violet-500/15 text-violet-600 dark:text-violet-400'}"
												>{call.cached}</span
											>
										</div>
										<div class="text-muted-foreground mt-px pl-4">
											{callTarget(call.target)} — {call.note}
										</div>
									</li>
								{/each}
							</ol>
						{/if}
						{#if step.gap}
							<div
								class="mt-2 rounded border border-dashed border-amber-500/40 bg-amber-500/6 px-1.5 py-1 text-[9.5px] leading-snug text-amber-700 dark:text-amber-300"
							>
								<span class="font-semibold">gap:</span>
								{step.gap}
							</div>
						{/if}
						{#if step.caches}
							<div class="mt-1.5 flex flex-wrap gap-1">
								{#each step.caches as ref (ref.id)}
									<span
										class="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-600 dark:text-violet-400"
									>
										<span class="size-1 rounded-full bg-violet-500" aria-hidden="true"></span>
										{cacheName(ref.id)}{#if cacheLifetime(ref.id)}<span class="opacity-70">
												· {cacheLifetime(ref.id)}</span
											>{/if}
									</span>
								{/each}
							</div>
						{/if}
					{/if}
				</button>
			{/if}
		{/each}
	</div>
</div>

<!-- Legend -->
<div class="text-muted-foreground mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
	<span class="flex items-center gap-1.5">
		<svg width="22" height="6"
			><line x1="0" y1="3" x2="22" y2="3" stroke="var(--color-primary)" stroke-width="2.5" /></svg
		>
		network hop (labelled with protocol)
	</span>
	<span class="flex items-center gap-1.5">
		<svg width="22" height="6"
			><line
				x1="0"
				y1="3"
				x2="22"
				y2="3"
				stroke="var(--color-primary)"
				stroke-width="2"
				stroke-dasharray="6 5"
			/></svg
		>
		in-process (function call)
	</span>
	<span class="flex items-center gap-1.5">
		<svg width="22" height="6"
			><line x1="0" y1="3" x2="22" y2="3" stroke="#0ea5e9" stroke-width="2" /></svg
		>
		response
	</span>
	{#if mode === 'cloud'}
		<span class="flex items-center gap-1.5">
			<svg width="22" height="6"
				><line
					x1="0"
					y1="3"
					x2="22"
					y2="3"
					stroke="#8b5cf6"
					stroke-width="1.5"
					stroke-dasharray="4 3"
				/></svg
			>
			cache-hit fast path
		</span>
	{/if}
	<span class="flex items-center gap-1.5">
		<span
			class="size-2 rounded-full border border-violet-500/40 bg-violet-500/15"
			aria-hidden="true"
		></span>
		cache
	</span>
	<span class="ml-auto hidden sm:inline">click a node for the full story</span>
</div>

<style>
	/* In-process / same-machine flow: dashed + animated (a function call). */
	.edge-flow {
		stroke-dasharray: 6 6;
		animation: flow-dash 0.9s linear infinite;
	}
	/* Network hop: solid line — reads as "the wire" crossing a machine boundary,
	   versus the dashed same-machine calls. */
	.edge-network {
		stroke-dasharray: none;
	}
	.edge-hit {
		stroke-dasharray: 4 4;
	}
	@keyframes flow-dash {
		to {
			stroke-dashoffset: -12;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.edge-flow {
			animation: none;
		}
	}
</style>
