<script lang="ts">
	// Two numbers, one of which follows the other: Rhino's worker pool, and Selva's
	// cap on how many solves it will have in flight. rhino.compute round-robins its
	// workers and never signals "busy", so nothing downstream enforces the cap —
	// which is why Selva reads the pool size instead of assuming it.
	const SOLVE_MS = 3200;
	const TICK_MS = 50;

	type Job = { id: number; progress: number };

	// The pool an operator configured on the VM (--childcount).
	let workers = $state(4);
	// What Selva currently believes, adopted from the pool at connect and re-read
	// after solves. Deliberately lags `workers` until a probe happens.
	let cap = $state(4);
	let autoDetect = $state(true);

	let running = $state<Job[]>([]);
	let waiting = $state<number[]>([]);
	let finished = $state(0);
	let next = $state(1);
	let probedJustNow = $state(false);
	let ticker: ReturnType<typeof setTimeout> | undefined;
	let probeFlash: ReturnType<typeof setTimeout> | undefined;

	const stale = $derived(autoDetect && cap !== workers);
	// Rotation doubles requests onto workers when Selva's cap exceeds the pool.
	const overloaded = $derived(running.length > workers);

	function pump() {
		while (running.length < cap && waiting.length > 0) {
			const id = waiting[0];
			waiting = waiting.slice(1);
			running = [...running, { id, progress: 0 }];
		}
		if (running.length > 0 && ticker === undefined) start();
	}

	function probe() {
		if (!autoDetect) return;
		cap = workers;
		probedJustNow = true;
		clearTimeout(probeFlash);
		probeFlash = setTimeout(() => (probedJustNow = false), 1200);
		pump();
	}

	function start() {
		ticker = setInterval(() => {
			// Doubled-up workers halve throughput — the cost of a cap above the pool.
			const speed = running.length > workers ? workers / running.length : 1;
			const step = (TICK_MS / SOLVE_MS) * 100 * speed;
			const done = running.filter((j) => j.progress + step >= 100);

			running = running
				.map((j) => ({ ...j, progress: j.progress + step }))
				.filter((j) => j.progress < 100);
			finished += done.length;

			// The real refresh rides on solve completion, not a timer.
			if (done.length > 0) {
				probe();
				pump();
			}

			if (running.length === 0) {
				clearInterval(ticker);
				ticker = undefined;
			}
		}, TICK_MS);
	}

	function send(n: number) {
		for (let i = 0; i < n; i++) waiting = [...waiting, next++];
		pump();
	}

	function reset() {
		clearInterval(ticker);
		clearTimeout(probeFlash);
		ticker = undefined;
		running = [];
		waiting = [];
		finished = 0;
		next = 1;
		workers = 4;
		cap = 4;
		autoDetect = true;
		probedJustNow = false;
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap items-center gap-2">
		<button
			class="bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
			onclick={() => send(1)}
		>
			one solve
		</button>
		<button
			class="border-border hover:bg-muted rounded border px-3 py-1.5 text-xs font-medium transition"
			onclick={() => send(8)}
		>
			eight at once
		</button>
		<button
			class="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
			onclick={reset}
		>
			reset
		</button>
	</div>

	<!-- The two numbers, side by side: the pool, and what Selva thinks it is. -->
	<div class="grid grid-cols-2 gap-2">
		<div class="border-border rounded-md border p-2.5">
			<p class="text-muted-foreground text-[11px] tracking-wide uppercase">workers on the VM</p>
			<div class="mt-1.5 flex items-center gap-2">
				<button
					class="border-border hover:bg-muted size-6 rounded border font-mono text-xs"
					onclick={() => (workers = Math.max(1, workers - 1))}
					aria-label="Remove a worker"
				>
					−
				</button>
				<span class="w-5 text-center font-mono text-sm tabular-nums">{workers}</span>
				<button
					class="border-border hover:bg-muted size-6 rounded border font-mono text-xs"
					onclick={() => (workers = Math.min(8, workers + 1))}
					aria-label="Add a worker"
				>
					+
				</button>
				<span class="text-muted-foreground ml-auto text-[11px]">--childcount</span>
			</div>
		</div>

		<div
			class="rounded-md border p-2.5 transition-colors {probedJustNow
				? 'border-emerald-500/50 bg-emerald-500/5'
				: stale
					? 'border-amber-500/40 bg-amber-500/5'
					: 'border-border'}"
		>
			<p class="text-muted-foreground text-[11px] tracking-wide uppercase">Selva sends at once</p>
			<div class="mt-1.5 flex items-center gap-2">
				<span class="font-mono text-sm tabular-nums">{cap}</span>
				{#if probedJustNow}
					<span class="text-[11px] text-emerald-600 dark:text-emerald-400">just re-read</span>
				{:else if stale}
					<span class="text-[11px] text-amber-600 dark:text-amber-400">stale until next solve</span>
				{/if}
				<label class="text-muted-foreground ml-auto flex items-center gap-1 text-[11px]">
					<input type="checkbox" bind:checked={autoDetect} class="accent-primary size-3" />
					auto
				</label>
			</div>
		</div>
	</div>

	<div>
		<p class="text-muted-foreground mb-1.5 text-[11px] tracking-wide uppercase">
			in flight · cap {cap}
		</p>
		<div class="grid grid-cols-8 gap-1.5">
			{#each Array(8) as _, i (i)}
				{@const job = running[i]}
				{@const withinCap = i < cap}
				<div
					class="relative h-9 overflow-hidden rounded border {withinCap
						? 'border-border'
						: 'border-border/30'}"
				>
					{#if job}
						<div
							class="absolute inset-y-0 left-0 transition-[width] duration-75 ease-linear {i >=
							workers
								? 'bg-amber-500/25'
								: 'bg-sky-500/20'}"
							style="width: {job.progress}%"
							aria-hidden="true"
						></div>
						<span
							class="absolute inset-0 flex items-center justify-center font-mono text-xs {i >=
							workers
								? 'text-amber-700 dark:text-amber-300'
								: 'text-sky-700 dark:text-sky-300'}"
						>
							{job.id}
						</span>
					{:else if withinCap}
						<span
							class="text-muted-foreground/40 absolute inset-0 flex items-center justify-center text-xs"
						>
							·
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	<div>
		<p class="text-muted-foreground mb-1.5 text-[11px] tracking-wide uppercase">
			waiting their turn
		</p>
		<div class="bg-muted/40 flex min-h-9 flex-wrap items-center gap-1.5 rounded p-1.5">
			{#each waiting as id (id)}
				<span
					class="rounded bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-600 dark:text-amber-400"
				>
					{id}
				</span>
			{:else}
				<span class="text-muted-foreground text-[11px] italic">nothing queued</span>
			{/each}
		</div>
	</div>

	<p class="text-xs {overloaded ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}">
		{#if overloaded}
			More in flight than there are workers — the extra ones share, so everything runs slower.
			Nothing failed.
		{:else}
			finished <span class="text-foreground font-mono tabular-nums">{finished}</span>
			· none dropped — a queued solve always runs, it just waits
		{/if}
	</p>
</div>
