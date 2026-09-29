<script lang="ts">
	// The one place a solve talks to the user.
	//
	// Only a Selva Message component interrupts: the author wrote that text for whoever is using
	// the app. Grasshopper's own warnings are about the definition, not the result, and go to the
	// footer log instead — interrupting for them trains people to dismiss the one that mattered.
	//
	// While the solve runs the panel is fed by live events (messages and progress) and offers
	// Abort. When it ends the reported result replaces them outright — it lists the same messages,
	// remarks included — so nothing is ever shown twice.
	//
	// Of those, only warnings and errors get buttons. A remark states something without asking
	// anything, so it appears on its own after the solve and fades.

	import { untrack } from 'svelte';
	import { CircleAlert, TriangleAlert, Info, LoaderCircle, Square } from '@lucide/svelte';
	import type { SolveDiagnostic } from '@selvajs/solve/shared';
	import type { LiveSolveState, SolvePhase } from '@selvajs/solve/client';
	import { Button } from '$lib/components/primitives/button';

	interface Props {
		/** What the running (or most recent) solve has said over the live channel. */
		live: LiveSolveState;
		/** The session's phase: `solving`, `review` (result held), `blocked` or `idle`. */
		phase: SolvePhase;
		/** The last result's messages, with level, source and `isGate`. */
		diagnostics?: SolveDiagnostic[];
		onabort: () => void;
		onconfirm: () => void;
		ondiscard: () => void;
		labels?: Labels;
	}

	interface Labels {
		solving: string;
		blockedTitle: string;
		messagesTitle: string;
		blockedDescription: string;
		messagesDescription: string;
		confirm: string;
		discard: string;
		abort: string;
		dismiss: string;
	}

	const DEFAULT_LABELS: Labels = {
		solving: 'Solving…',
		blockedTitle: 'Solve stopped',
		messagesTitle: 'Solve messages',
		blockedDescription: 'The definition stopped this solve. No results were produced.',
		messagesDescription: 'This solve reported the following. Continue to see the result.',
		confirm: 'Continue',
		discard: 'Discard',
		abort: 'Abort',
		dismiss: 'Dismiss'
	};

	let {
		live,
		phase: sessionPhase,
		diagnostics = [],
		onabort,
		onconfirm,
		ondiscard,
		labels = DEFAULT_LABELS
	}: Props = $props();

	const REMARK_LINGER_MS = 6000;

	const progress = $derived([...live.progress.values()]);

	// A report only arrives when a step starts, so a bar that just shows `fraction` stands still
	// through the step and then jumps. When the plugin knows how long the step took last time, the
	// bar runs linearly to where the step will end, over that time. Steps are weighted by time, so
	// linear gives one steady speed across the solve; any easing curve visibly speeds up and
	// crawls within each step. A slower run waits at the step's end; a faster one snaps ahead.
	let bars = $state.raw<Record<string, { width: number; ms: number }>>({});
	// Any live event re-runs the effect below. Only a source with a new report may re-snap;
	// the rest keep easing where they are.
	let seen = new Map<string, unknown>();
	let targets: Record<string, { width: number; ms: number }> = {};
	$effect(() => {
		const snapped: Record<string, { width: number; ms: number }> = {};
		const eased: Record<string, { width: number; ms: number }> = {};
		const current = untrack(() => bars);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping for this effect; reactive reads here would re-trigger it
		const nextSeen = new Map<string, unknown>();
		for (const p of progress) {
			if (p.fraction === undefined) continue;
			const key = p.source ?? '';
			nextSeen.set(key, p);
			if (seen.get(key) === p && current[key]) {
				snapped[key] = current[key];
				// This run's cleanup cancelled the frame that would have started the ease.
				if (targets[key] && current[key] !== targets[key]) eased[key] = targets[key];
				continue;
			}
			snapped[key] = { width: p.fraction, ms: 150 };
			if (p.nextFraction !== undefined && p.stepMs !== undefined) {
				eased[key] = { width: p.nextFraction, ms: p.stepMs };
			}
		}
		seen = nextSeen;
		targets = eased;
		bars = snapped;
		if (Object.keys(eased).length === 0) return;
		// Two frames: the snapped width must be painted before the eased one is set, or the
		// browser folds both into one style change and there is nothing to transition from.
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => (bars = { ...snapped, ...eased }));
		});
		return () => cancelAnimationFrame(frame);
	});
	// Grasshopper's own complaints stay in the footer log; this panel shows what the author wrote.
	const authored = $derived(diagnostics.filter((d) => d.isGate));

	// A remark states something without asking anything, so it never belongs next to
	// Discard/Continue — the buttons would imply it is part of what the user is deciding. It gets
	// the quiet treatment instead: shown alone after the solve, then faded.
	const authoredGating = $derived(authored.filter((d) => d.level !== 'remark'));
	const authoredRemarks = $derived(authored.filter((d) => d.level === 'remark'));

	let dismissedFor = $state.raw<SolveDiagnostic[] | null>(null);

	// The session's phase, except that a blocked solve the user dismissed reads as idle here.
	type Phase = 'live' | 'review' | 'blocked' | 'idle';
	const phase = $derived<Phase>(
		sessionPhase === 'solving'
			? 'live'
			: sessionPhase === 'blocked' && dismissedFor === diagnostics
				? 'idle'
				: sessionPhase
	);

	// While solving, the live channel is all there is. Once the result lands it is authoritative
	// — it carries remarks too — so the live list is dropped entirely and nothing is shown twice.
	const rows = $derived<SolveDiagnostic[]>(
		phase === 'live' ? [...live.diagnostics] : phase === 'idle' ? authoredRemarks : authoredGating
	);

	// Remarks gate nothing, so after the solve they show briefly and fade.
	//
	// Keyed on the diagnostics array's identity, which every report renews, rather than on a
	// solve id: only the live channel has one, and on the Compute path remarks arrive with the
	// result. Once per array, so remarks that sat behind a review do not reappear after Continue.
	let lingering = $state(false);
	let lingeredFor: SolveDiagnostic[] | null = null;
	$effect(() => {
		if (phase === 'live') {
			lingering = false;
			return;
		}
		if (authoredRemarks.length === 0 || lingeredFor === diagnostics) return;
		lingeredFor = diagnostics;
		if (phase !== 'idle') return;
		lingering = true;
		const timer = setTimeout(() => (lingering = false), REMARK_LINGER_MS);
		return () => clearTimeout(timer);
	});

	// A solve that finishes quickly never shows the live panel: flashing it for 50 ms reads as a
	// glitch, not as progress.
	const LIVE_REVEAL_MS = 300;
	let revealed = $state(false);
	$effect(() => {
		if (phase !== 'live') {
			revealed = false;
			return;
		}
		const timer = setTimeout(() => (revealed = true), LIVE_REVEAL_MS);
		return () => clearTimeout(timer);
	});

	const visible = $derived(
		phase === 'review' || phase === 'blocked'
			? true
			: phase === 'live'
				? revealed && (rows.length > 0 || progress.length > 0)
				: rows.length > 0 && lingering
	);

	function dismiss() {
		dismissedFor = diagnostics;
	}

	// Escape resolves to the safe side — discard, keeping what is on screen — never to silently
	// applying a result the user has not accepted.
	function handleKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		if (phase === 'review') ondiscard();
		else if (phase === 'blocked') dismiss();
	}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if visible}
	<div
		class="bottom-4 p-3 shadow-lg fixed left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border bg-background {phase ===
		'blocked'
			? 'border-destructive/50'
			: ''}"
		role={phase === 'live' || phase === 'idle' ? 'status' : 'alert'}
		data-testid="solve-messages"
		data-phase={phase}
	>
		{#if phase === 'live'}
			{@const head = progress[0]}
			<div class="gap-3 flex items-center">
				<div class="min-w-0 flex-1">
					<div class="gap-2 flex items-center">
						<LoaderCircle class="h-4 w-4 animate-spin shrink-0 text-muted-foreground" />
						<span class="min-w-0 text-sm flex-1 truncate">{head?.label ?? labels.solving}</span>
						{#if head?.done !== undefined && head?.total !== undefined}
							<span class="text-xs shrink-0 text-muted-foreground tabular-nums">
								{head.done} / {head.total}
							</span>
						{/if}
					</div>
					{#each progress as p, i (p.source ?? '')}
						<div class="mt-2" data-testid="solve-progress">
							<!-- The first bar's label is the headline above; further bars label themselves. -->
							{#if i > 0}
								<div class="mb-1 gap-2 text-xs flex justify-between text-muted-foreground">
									<span class="truncate">{p.label ?? p.source ?? ''}</span>
									{#if p.done !== undefined && p.total !== undefined}
										<span class="shrink-0 tabular-nums">{p.done} / {p.total}</span>
									{/if}
								</div>
							{/if}
							<div
								class="h-1 overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-label={p.label ?? p.source ?? labels.solving}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={p.fraction !== undefined ? Math.round(p.fraction * 100) : undefined}
							>
								{#if p.fraction !== undefined}
									{@const bar = bars[p.source ?? ''] ?? { width: p.fraction, ms: 150 }}
									<div
										class="h-full rounded-full bg-primary transition-[width] ease-linear"
										style="width: {bar.width * 100}%; transition-duration: {bar.ms}ms"
									></div>
								{:else}
									<div class="animate-pulse h-full w-1/3 rounded-full bg-primary/60"></div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				<Button variant="outline" size="sm" class="shrink-0" onclick={onabort}>
					<Square class="h-3 w-3 fill-current" />
					{labels.abort}
				</Button>
			</div>
		{:else if phase === 'review' || phase === 'blocked'}
			<div class="mb-2">
				<div class="gap-2 text-sm font-medium flex items-center">
					{#if phase === 'blocked'}
						<CircleAlert class="h-4 w-4 shrink-0 text-destructive" />
						{labels.blockedTitle}
					{:else}
						<TriangleAlert class="h-4 w-4 text-amber-500 shrink-0" />
						{labels.messagesTitle}
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">
					{phase === 'blocked' ? labels.blockedDescription : labels.messagesDescription}
				</p>
			</div>
		{/if}

		{#if rows.length > 0}
			<ul
				class="max-h-40 space-y-2 text-sm overflow-y-auto {phase === 'live'
					? 'mt-3 pt-3 border-t'
					: ''}"
			>
				{#each rows as row, i (i)}
					<li class="gap-2 flex">
						{#if row.level === 'error'}
							<CircleAlert class="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
						{:else if row.level === 'warning'}
							<TriangleAlert class="mt-0.5 h-4 w-4 text-amber-500 shrink-0" />
						{:else}
							<Info class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						{/if}
						<div class="min-w-0 flex-1">
							<p class="wrap-anywhere">{row.message}</p>
							{#if row.source}
								<p class="text-xs text-muted-foreground">{row.source}</p>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		{#if phase === 'review' || phase === 'blocked'}
			<div class="mt-3 gap-2 flex justify-end">
				{#if phase === 'blocked'}
					<Button variant="outline" size="sm" onclick={dismiss}>{labels.dismiss}</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={ondiscard}>{labels.discard}</Button>
					<Button size="sm" onclick={onconfirm}>{labels.confirm}</Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
