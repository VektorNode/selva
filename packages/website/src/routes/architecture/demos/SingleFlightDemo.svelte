<script lang="ts">
	// Coalescing, not caching: the key is released the moment the flight settles,
	// so a request arriving after it cannot be answered from anything. The bar makes
	// that window visible — it IS the solve, not a configured timeout.
	const RUN_MS = 2400;
	const TICK_MS = 50;

	type Rider = { id: number; joinedAtPct: number };

	let owner = $state<number | null>(null);
	let joiners = $state<Rider[]>([]);
	let progress = $state(0);
	let solves = $state(0);
	let served = $state(0);
	let next = $state(1);
	// Cleared on settle so the last flight's outcome stays readable while idle.
	let lastFlight = $state<{ rode: number } | null>(null);
	let missed = $state(false);
	let ticker: ReturnType<typeof setInterval> | undefined;
	let missTimer: ReturnType<typeof setTimeout> | undefined;

	function settle() {
		clearInterval(ticker);
		served += 1 + joiners.length;
		lastFlight = { rode: joiners.length };
		owner = null;
		joiners = [];
		progress = 0;
	}

	function request() {
		const id = next++;

		if (owner !== null) {
			joiners = [...joiners, { id, joinedAtPct: progress }];
			return;
		}

		// A request arriving with nothing in flight pays full price — flash that,
		// since "just missed it" is the behaviour people misread as a cache.
		if (lastFlight) {
			missed = true;
			clearTimeout(missTimer);
			missTimer = setTimeout(() => (missed = false), 900);
		}

		owner = id;
		solves += 1;
		progress = 0;
		lastFlight = null;
		ticker = setInterval(() => {
			progress = Math.min(100, progress + (TICK_MS / RUN_MS) * 100);
			if (progress >= 100) settle();
		}, TICK_MS);
	}

	function reset() {
		clearInterval(ticker);
		clearTimeout(missTimer);
		owner = null;
		joiners = [];
		progress = 0;
		solves = 0;
		served = 0;
		next = 1;
		lastFlight = null;
		missed = false;
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<button
			class="bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
			onclick={request}
		>
			send a request
		</button>
		<span class="text-muted-foreground text-xs">
			{owner !== null ? 'now click again while it runs' : 'same inputs, same version'}
		</span>
		<button
			class="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
			onclick={reset}
		>
			reset
		</button>
	</div>

	<div class="border-border relative min-h-24 overflow-hidden rounded-md border">
		<!-- The window itself. Riders sit at the fraction of it they arrived in. -->
		{#if owner !== null}
			<div
				class="absolute inset-y-0 left-0 bg-sky-500/10 transition-[width] duration-75 ease-linear"
				style="width: {progress}%"
				aria-hidden="true"
			></div>
		{/if}

		<div class="relative p-2.5">
			{#if owner !== null}
				<div class="flex items-baseline justify-between">
					<p class="font-mono text-xs">
						<span class="text-sky-600 dark:text-sky-400">request {owner}</span>
						<span class="text-muted-foreground"> is solving…</span>
					</p>
					<span class="text-muted-foreground font-mono text-[11px] tabular-nums">
						{Math.round((progress / 100) * RUN_MS) / 1000}s
					</span>
				</div>

				<div class="mt-2 flex min-h-6 flex-wrap items-center gap-1.5">
					{#each joiners as rider (rider.id)}
						<span
							class="rounded bg-cyan-500/10 px-2 py-0.5 font-mono text-[11px] text-cyan-600 dark:text-cyan-400"
						>
							{rider.id} joined at {Math.round(rider.joinedAtPct)}%
						</span>
					{:else}
						<span class="text-muted-foreground text-[11px] italic">
							no one else has joined yet
						</span>
					{/each}
				</div>
			{:else}
				<p
					class="text-xs {missed ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}"
				>
					{#if missed}
						Too late — the previous run had already finished, so this one pays full price.
					{:else if lastFlight}
						Done. One solve served {lastFlight.rode + 1}
						{lastFlight.rode === 0 ? 'request' : 'requests'}, then the key was released — nothing is
						kept, so the next request starts from scratch.
					{:else}
						Nothing in flight. The first request starts a solve; anything identical arriving before
						it finishes rides along for free.
					{/if}
				</p>
			{/if}
		</div>
	</div>

	<p class="text-muted-foreground text-xs">
		responses served <span class="text-foreground font-mono tabular-nums">{served}</span>
		· actual solves <span class="text-foreground font-mono tabular-nums">{solves}</span>
		{#if served > solves}
			<span class="text-emerald-600 dark:text-emerald-400">
				· {served - solves} rode along free
			</span>
		{/if}
	</p>
</div>
