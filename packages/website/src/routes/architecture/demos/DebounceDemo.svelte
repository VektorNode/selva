<script lang="ts">
	// Mirrors the 150 ms slider commit in NumberInput.svelte. The timer is real —
	// dragging fast genuinely produces one commit, which is the whole point.
	const WINDOW_MS = 150;

	let value = $state(20);
	let moves = $state(0);
	let commits = $state<number[]>([]);
	let pending = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function onInput() {
		moves += 1;
		pending = true;
		clearTimeout(timer);
		timer = setTimeout(() => {
			pending = false;
			commits = [...commits, value].slice(-6);
		}, WINDOW_MS);
	}

	function reset() {
		clearTimeout(timer);
		moves = 0;
		commits = [];
		pending = false;
	}
</script>

<div class="space-y-3">
	<input
		type="range"
		min="0"
		max="100"
		bind:value
		oninput={onInput}
		class="accent-primary w-full"
		aria-label="Demo slider"
	/>

	<div class="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
		<span class="text-muted-foreground">
			moves <span class="text-foreground font-mono tabular-nums">{moves}</span>
		</span>
		<span class="text-muted-foreground">
			solves <span class="text-foreground font-mono tabular-nums">{commits.length}</span>
		</span>
		{#if pending}
			<span class="font-mono text-amber-600 dark:text-amber-400">waiting {WINDOW_MS} ms…</span>
		{/if}
		<button class="text-muted-foreground hover:text-foreground ml-auto underline" onclick={reset}>
			reset
		</button>
	</div>

	<div class="flex min-h-7 flex-wrap items-center gap-1.5">
		{#each commits as commit, i (i)}
			<span
				class="rounded bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-600 tabular-nums dark:text-emerald-400"
			>
				{commit}
			</span>
		{:else}
			<span class="text-muted-foreground text-xs italic">no solves yet — drag the slider</span>
		{/each}
	</div>
</div>
