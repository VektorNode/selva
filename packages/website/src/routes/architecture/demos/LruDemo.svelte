<script lang="ts">
	// Same eviction order as createSolveMemo, shrunk to 4 entries so the tail is
	// visible in a few clicks. The real memo holds 16.
	const MAX = 4;

	let entries = $state<number[]>([]);
	let lastAction = $state<{ value: number; hit: boolean; evicted?: number } | null>(null);

	function solve(value: number) {
		const hit = entries.includes(value);
		const next = entries.filter((e) => e !== value);
		next.push(value);

		let evicted: number | undefined;
		if (next.length > MAX) evicted = next.shift();

		entries = next;
		lastAction = { value, hit, evicted };
	}

	function reset() {
		entries = [];
		lastAction = null;
	}
</script>

<div class="space-y-3">
	<div class="flex flex-wrap items-center gap-1.5">
		{#each [10, 20, 30, 40, 50] as value (value)}
			<button
				class="border-border hover:bg-muted rounded border px-2.5 py-1 font-mono text-xs tabular-nums transition"
				onclick={() => solve(value)}
			>
				radius {value}
			</button>
		{/each}
		<button
			class="text-muted-foreground hover:text-foreground ml-auto text-xs underline"
			onclick={reset}
		>
			reset
		</button>
	</div>

	<!-- Left is the eviction end: the next entry to fall off. -->
	<div class="bg-muted/40 flex min-h-12 items-center gap-1.5 rounded-md p-2">
		{#each entries as entry (entry)}
			<span
				class="rounded border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 font-mono text-xs text-violet-600 tabular-nums dark:text-violet-400"
			>
				{entry}
			</span>
		{:else}
			<span class="text-muted-foreground text-xs italic">memo empty</span>
		{/each}
		<span class="text-muted-foreground ml-auto font-mono text-[11px] tabular-nums">
			{entries.length}/{MAX}
		</span>
	</div>

	<p class="min-h-4 text-xs">
		{#if lastAction?.hit}
			<span class="font-medium text-emerald-600 dark:text-emerald-400">HIT</span>
			<span class="text-muted-foreground">
				— served from memory, no request. Moved to the newest end.
			</span>
		{:else if lastAction}
			<span class="text-muted-foreground">
				MISS — solved, then stored.{lastAction.evicted !== undefined
					? ` Evicted ${lastAction.evicted}, the least recently used.`
					: ''}
			</span>
		{/if}
	</p>
</div>
