<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { Check, LoaderCircle } from '@lucide/svelte';
	import { EMPTY_LIVE_SOLVE, type LiveSolveState } from '@selvajs/solve/client';
	import { Button } from '#lib/components/primitives/button/index.js';
	import { createLiveProgress } from '#lib/compute/liveProgress.svelte.js';
	import { getLocaleContext } from '../../i18n/localeContext.svelte';

	// The solve status in a panel's action row, one line in every state: a quiet "up to date", a
	// pill once a solve is visible, then the step, elapsed time and Abort once it is slow.
	interface Props {
		/** The raw flag: times the solve, and acknowledges one too short to show. */
		isSolving: boolean;
		/** `createSolvingIndicator(...).show`. */
		show: boolean;
		/** `createSolvingIndicator(...).slow`. */
		slow?: boolean;
		/** Live progress: the card names the current step and its count. */
		live?: LiveSolveState;
		/** Without it the card has no Abort button; Esc still works where the host handles it. */
		onabort?: () => void;
		/**
		 * The page can't repaint mid-solve (see `createSolvingIndicator`): the pill says Esc aborts
		 * instead of counting seconds, and never adds Abort or the step.
		 */
		freezesDuringSolve?: boolean;
	}

	let {
		isSolving,
		show,
		slow = false,
		live,
		onabort,
		freezesDuringSolve = false
	}: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

	const DONE_VISIBLE_MS = 1400;
	// A drag fires a solve per step; one acknowledgement per this many ms is enough.
	const PING_EVERY_MS = 500;

	const progress = createLiveProgress(() => live ?? EMPTY_LIVE_SOLVE);
	const head = $derived(progress.headline ?? progress.progress[0]);

	let startedAt = 0;
	let wasSolving = false;
	let elapsed = $state(0);
	let finished = $state<{ ms: number; aborted: boolean } | null>(null);
	let ping = $state(0);
	let lastPingAt = 0;
	// Not `show` itself at the solve's end: the host's indicator may already have dropped it.
	let shownThisSolve = false;

	$effect(() => {
		if (show) shownThisSolve = true;
	});

	$effect(() => {
		const solving = isSolving;
		untrack(() => {
			// Transitions only: the cloud session re-notifies `isSolving` unchanged on every live
			// event and on the result, and restarting the clock there made a long solve end on 0.0 s.
			if (solving === wasSolving) return;
			wasSolving = solving;
			if (solving) {
				startedAt = performance.now();
				shownThisSolve = show;
				elapsed = 0;
				finished = null;
				return;
			}
			const ms = performance.now() - startedAt;
			startedAt = 0;
			if (shownThisSolve) {
				finished = { ms, aborted: live?.ended?.kind === 'aborted' };
			} else if (performance.now() - lastPingAt > PING_EVERY_MS) {
				lastPingAt = performance.now();
				ping++;
			}
		});
	});

	$effect(() => {
		if (!finished) return;
		const timer = setTimeout(() => (finished = null), DONE_VISIBLE_MS);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (!isSolving || !show || freezesDuringSolve) return;
		const tick = () => (elapsed = performance.now() - startedAt);
		tick();
		const id = setInterval(tick, 100);
		return () => clearInterval(id);
	});

	// Done wins over a held `show`: the indicator outlives the solve by up to its minimum time,
	// and saying "Solving" over a result that has already landed would be wrong.
	const mode = $derived<'idle' | 'work' | 'card' | 'done'>(
		finished ? 'done' : show ? (slow && !freezesDuringSolve ? 'card' : 'work') : 'idle'
	);

	const seconds = $derived(
		new Intl.NumberFormat(locale.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
	);
	const fmt = (ms: number) => `${seconds.format(ms / 1000)} s`;

	const announcement = $derived(
		mode === 'work' || mode === 'card'
			? t.solvingEllipsis
			: mode === 'done'
				? finished?.aborted
					? t.solveStopped
					: t.solveDone
				: ''
	);
</script>

<div class="h-10 min-w-0 relative flex-1">
	<!-- The live region stays mounted: a screen reader only announces text that changes inside a
	     region it already knows about, so one created together with its text says nothing. -->
	<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{announcement}</div>

	<div
		class="inset-x-0 bottom-0 h-10 backdrop-blur-md ease-out absolute z-10 overflow-hidden rounded-md border border-border-strong transition-all duration-300 motion-reduce:transition-none {mode ===
		'idle'
			? 'shadow-sm bg-card/90'
			: 'shadow-md bg-card/75'}"
		data-testid="solve-status"
		data-state={mode}
	>
		{#if mode === 'card'}
			<div
				class="pl-3 pr-1.5 gap-2 @container/solve-card flex h-full items-center"
				in:fade={{ duration: 150, delay: 80 }}
			>
				<LoaderCircle
					class="size-4 animate-spin shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<span class="text-sm font-medium min-w-0 truncate">{head?.label ?? t.solving}</span>
				{#if head?.done !== undefined && head?.total !== undefined}
					<span class="text-xs shrink-0 text-muted-foreground tabular-nums">
						{head.done} / {head.total}
					</span>
				{/if}
				<span class="text-xs shrink-0 text-muted-foreground tabular-nums">{fmt(elapsed)}</span>
				{#if onabort}
					<Button
						variant="outline"
						size="xs"
						class="ml-auto shrink-0"
						onclick={onabort}
						aria-keyshortcuts="Escape"
						title={t.solveMessagesEscHint}
					>
						{t.solveMessagesAbort}
						<kbd
							class="px-1 @xs/solve-card:inline hidden rounded-sm border border-border font-sans text-2xs text-muted-foreground"
						>
							Esc
						</kbd>
					</Button>
				{/if}
			</div>
		{:else if mode === 'work'}
			<div class="px-3 gap-2 flex h-full items-center" in:fade={{ duration: 150, delay: 80 }}>
				<LoaderCircle
					class="size-4 animate-spin shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				{#if freezesDuringSolve}
					<span class="text-sm font-medium shrink-0">{t.solvingEllipsis}</span>
					<span class="text-xs min-w-0 truncate text-muted-foreground" data-testid="solve-esc-hint">
						{t.solveMessagesEscHint}
					</span>
				{:else}
					<span class="text-sm font-medium shrink-0">{t.solving}</span>
					<span class="text-xs text-muted-foreground tabular-nums">{fmt(elapsed)}</span>
				{/if}
			</div>
		{:else if mode === 'done' && finished}
			<div class="px-3 gap-2 flex h-full items-center" in:fade={{ duration: 150, delay: 80 }}>
				{#if finished.aborted}
					<span class="text-sm font-medium min-w-0 truncate">{t.solveStopped}</span>
				{:else}
					<Check class="size-4 shrink-0 text-success" aria-hidden="true" />
					<span class="text-sm font-medium shrink-0">{t.solveDone}</span>
					<span class="text-xs text-muted-foreground tabular-nums">{fmt(finished.ms)}</span>
				{/if}
			</div>
		{:else}
			<div class="px-3 gap-2 flex h-full items-center" in:fade={{ duration: 150 }}>
				<span class="size-1.5 relative shrink-0 rounded-full bg-success">
					{#key ping}
						{#if ping > 0}
							<span class="solve-ping inset-0 absolute rounded-full border-2 border-success"></span>
						{/if}
					{/key}
				</span>
				<span class="text-sm min-w-0 truncate text-muted-foreground">{t.upToDate}</span>
			</div>
		{/if}
	</div>
</div>

<style>
	/* One ring that grows and fades: the result landed faster than an indicator could show. */
	.solve-ping {
		animation: solve-ping 0.6s ease-out forwards;
	}

	@keyframes solve-ping {
		from {
			transform: scale(1);
			opacity: 0.9;
		}
		to {
			transform: scale(3.2);
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.solve-ping {
			animation: none;
			opacity: 0;
		}
	}
</style>
