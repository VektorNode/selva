<script lang="ts">
	// The hero's right half: three Grasshopper-style sliders drive a recursive
	// form the way Selva's generated controls drive a definition. Renders bare —
	// the landing page's ink ground is its canvas.
	let branches = $state(3);
	let twist = $state(26);
	let depth = $state(5);

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
				walk(x2, y2, angle + offset * spread, length * 0.7, level + 1);
			}
		};
		walk(250, 460, 0, 105, 0);
		return segments;
	}
	const segments = $derived(grow());
</script>

{#snippet ghSlider(
	label: string,
	value: number,
	min: number,
	max: number,
	set: (v: number) => void
)}
	<label class="block">
		<span class="flex items-center justify-between font-mono text-xs text-white/55">
			{label}
			<span class="text-(--color-primary)">{Math.round(value)}</span>
		</span>
		<input
			type="range"
			{min}
			{max}
			{value}
			oninput={(e) => set(Number(e.currentTarget.value))}
			class="mt-1 w-full accent-(--color-primary)"
		/>
	</label>
{/snippet}

<div>
	<svg
		viewBox="30 50 440 420"
		class="h-80 w-full sm:h-[26rem]"
		role="img"
		aria-label="A parametric form that changes as you move the sliders"
	>
		{#each segments as s, i (i)}
			<line
				x1={s.x1}
				y1={s.y1}
				x2={s.x2}
				y2={s.y2}
				stroke="var(--color-primary)"
				stroke-width={Math.max(0.6, 5 - s.level * 0.9)}
				stroke-linecap="round"
				opacity={0.18 + (s.level / (depth + 1)) * 0.6}
			/>
		{/each}
		{#each segments.filter((s) => s.level === depth) as t, i (i)}
			<circle cx={t.x2} cy={t.y2} r="1.4" fill="white" opacity="0.45" />
		{/each}
	</svg>

	<div class="mx-auto mt-2 grid max-w-md grid-cols-3 gap-5">
		{@render ghSlider('branches', branches, 1, 4, (v) => (branches = v))}
		{@render ghSlider('twist', twist, 0, 60, (v) => (twist = v))}
		{@render ghSlider('depth', depth, 1, 6, (v) => (depth = v))}
	</div>
	<p class="mt-3 text-center font-mono text-xs text-white/35">
		{segments.length} segments — inputs in, geometry out
	</p>
</div>
