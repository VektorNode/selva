<script lang="ts">
	// The single pending slot from async-throttle.ts: one run in flight, one slot,
	// and a newer value overwrites whatever was waiting rather than queueing.
	const RUN_MS = 900;

	let running = $state<number | null>(null);
	let slot = $state<number | null>(null);
	let done = $state<number[]>([]);
	let dropped = $state<number[]>([]);
	let next = $state(1);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function finish() {
		done = [...done, running!].slice(-5);
		running = null;
		if (slot !== null) {
			const promoted = slot;
			slot = null;
			start(promoted);
		}
	}

	function start(value: number) {
		running = value;
		timer = setTimeout(finish, RUN_MS);
	}

	function trigger() {
		const value = next++;
		if (running === null) {
			start(value);
			return;
		}
		// Whatever was waiting never runs — this is the drop, not a queue.
		if (slot !== null) dropped = [...dropped, slot].slice(-5);
		slot = value;
	}

	function reset() {
		clearTimeout(timer);
		running = null;
		slot = null;
		done = [];
		dropped = [];
		next = 1;
	}
</script>

<div class="space-y-3">
	<div class="flex items-center gap-2">
		<button
			class="bg-primary text-primary-foreground rounded px-3 py-1.5 text-xs font-medium transition hover:opacity-90"
			onclick={trigger}
		>
			change a value
		</button>
		<span class="text-muted-foreground text-xs">click several times quickly</span>
		<button
			class="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
			onclick={reset}
		>
			reset
		</button>
	</div>

	<div class="grid grid-cols-2 gap-2">
		<div class="border-border rounded-md border p-2.5">
			<p class="text-muted-foreground text-[11px] tracking-wide uppercase">in flight</p>
			<p class="mt-1 font-mono text-sm tabular-nums">
				{#if running !== null}
					<span class="text-sky-600 dark:text-sky-400">value {running}</span>
				{:else}
					<span class="text-muted-foreground">idle</span>
				{/if}
			</p>
		</div>
		<div class="border-border rounded-md border p-2.5">
			<p class="text-muted-foreground text-[11px] tracking-wide uppercase">pending slot (max 1)</p>
			<p class="mt-1 font-mono text-sm tabular-nums">
				{#if slot !== null}
					<span class="text-amber-600 dark:text-amber-400">value {slot}</span>
				{:else}
					<span class="text-muted-foreground">empty</span>
				{/if}
			</p>
		</div>
	</div>

	<div class="space-y-1 text-xs">
		<p class="text-muted-foreground">
			solved
			{#each done as value (value)}
				<span class="ml-1 font-mono text-emerald-600 tabular-nums dark:text-emerald-400"
					>{value}</span
				>
			{/each}
		</p>
		<p class="text-muted-foreground min-h-4">
			{#if dropped.length}
				dropped, never solved
				{#each dropped as value (value)}
					<span class="ml-1 font-mono tabular-nums line-through">{value}</span>
				{/each}
			{/if}
		</p>
	</div>
</div>
