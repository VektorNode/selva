<script lang="ts">
	// The hero *is* the pitch: three sliders drive an SVG form the way Selva's
	// controls drive a Grasshopper definition. Everything is derived — moving a
	// slider re-solves the geometry, exactly like the real thing.
	let branches = $state(3);
	let twist = $state(28);
	let depth = $state(4);

	// Recursive branching: each segment spawns `branches` children, rotated by
	// `twist`, shrinking each level. This is the "definition" being solved.
	interface Segment {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
		level: number;
	}

	function grow(): Segment[] {
		const segments: Segment[] = [];
		const walk = (x: number, y: number, angle: number, length: number, level: number) => {
			const x2 = x + Math.sin(angle) * length;
			const y2 = y - Math.cos(angle) * length;
			segments.push({ x1: x, y1: y, x2, y2, level });
			if (level >= depth) return;
			const spread = (twist * Math.PI) / 180;
			for (let i = 0; i < branches; i++) {
				// Fan children symmetrically around the parent direction.
				const offset = branches === 1 ? 0 : (i / (branches - 1) - 0.5) * 2;
				walk(x2, y2, angle + offset * spread, length * 0.72, level + 1);
			}
		};
		walk(160, 322, 0, 96, 0);
		return segments;
	}

	const segments = $derived(grow());

	// Headline numbers, so the sliders visibly "solve" something.
	const vertexCount = $derived(segments.length + 1);

	// The form breathes until the first interaction, so the page shows what it
	// does before anyone touches it. Stops for good once a slider moves, and
	// respects a reduced-motion preference from the start.
	let touched = $state(false);

	$effect(() => {
		if (touched) return;
		const motionOk = window.matchMedia('(prefers-reduced-motion: no-preference)');
		if (!motionOk.matches) return;

		let frame: number;
		const start = performance.now();
		const tick = (now: number) => {
			twist = 24 + Math.sin((now - start) / 2200) * 14;
			frame = requestAnimationFrame(tick);
		};
		frame = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(frame);
	});

	function claim() {
		touched = true;
	}
</script>

<div class="border-border bg-card overflow-hidden rounded-2xl border shadow-sm">
	<!-- Canvas chrome: reads as a tool window, not a marketing card. -->
	<div class="border-border bg-muted/40 flex items-center gap-2 border-b px-4 py-2.5">
		<span class="size-2.5 rounded-full bg-red-400/60"></span>
		<span class="size-2.5 rounded-full bg-yellow-400/60"></span>
		<span class="size-2.5 rounded-full bg-green-400/60"></span>
		<span class="text-muted-foreground ml-2 font-mono text-xs">canopy.gh</span>
		<span
			class="text-primary border-primary/30 bg-primary/10 ml-auto rounded-full border px-2 py-0.5 font-mono text-[10px]"
		>
			{vertexCount} vertices
		</span>
	</div>

	<div class="grid md:grid-cols-[minmax(0,1fr)_260px]">
		<!-- The solved geometry -->
		<div class="relative min-h-80">
			<svg
				viewBox="10 30 300 300"
				preserveAspectRatio="xMidYMid meet"
				class="h-full w-full"
				role="img"
				aria-label="A parametric form that changes as you move the sliders"
			>
				<defs>
					<linearGradient id="limb" x1="0" y1="1" x2="0" y2="0">
						<stop offset="0%" stop-color="var(--color-muted-foreground)" />
						<stop offset="100%" stop-color="var(--color-primary)" />
					</linearGradient>
				</defs>
				{#each segments as seg, i (i)}
					<line
						x1={seg.x1}
						y1={seg.y1}
						x2={seg.x2}
						y2={seg.y2}
						stroke="url(#limb)"
						stroke-width={Math.max(0.9, 7 - seg.level * 1.25)}
						stroke-linecap="round"
						opacity={0.35 + (seg.level / (depth + 1)) * 0.65}
					/>
				{/each}
				{#each segments.filter((s) => s.level === depth) as tip, i (i)}
					<circle cx={tip.x2} cy={tip.y2} r="2" fill="var(--color-primary)" opacity="0.85" />
				{/each}
			</svg>
		</div>

		<!-- The controls, i.e. what Selva generates from your definition -->
		<div class="border-border bg-background/40 space-y-5 border-t p-5 md:border-t-0 md:border-l">
			<p class="text-muted-foreground text-xs">These are Grasshopper inputs. Drag one.</p>

			<label class="block">
				<span class="flex items-baseline justify-between text-sm font-medium">
					Branches
					<span class="text-muted-foreground font-mono text-xs">{branches}</span>
				</span>
				<input
					type="range"
					min="1"
					max="4"
					bind:value={branches}
					oninput={claim}
					class="accent-primary mt-2 w-full"
				/>
			</label>

			<label class="block">
				<span class="flex items-baseline justify-between text-sm font-medium">
					Twist
					<span class="text-muted-foreground font-mono text-xs">{Math.round(twist)}°</span>
				</span>
				<input
					type="range"
					min="0"
					max="60"
					bind:value={twist}
					oninput={claim}
					class="accent-primary mt-2 w-full"
				/>
			</label>

			<label class="block">
				<span class="flex items-baseline justify-between text-sm font-medium">
					Depth
					<span class="text-muted-foreground font-mono text-xs">{depth}</span>
				</span>
				<input
					type="range"
					min="1"
					max="6"
					bind:value={depth}
					oninput={claim}
					class="accent-primary mt-2 w-full"
				/>
			</label>

			<p class="text-muted-foreground/70 border-border border-t pt-4 text-xs leading-relaxed">
				In a real deployment this panel is generated from your definition, and the solve runs on
				Rhino.Compute.
			</p>
		</div>
	</div>
</div>
