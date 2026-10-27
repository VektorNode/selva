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
	import { LoaderCircle } from '@lucide/svelte';
	import type { SolveDiagnostic } from '@selvajs/solve/shared';
	import type { LiveSolveState, SolvePhase } from '@selvajs/solve/client';
	import { Button } from '$lib/components/primitives/button';
	import IssueList, { type Issue } from '$lib/components/primitives/IssueList.svelte';
	import SeverityIcon from '$lib/components/primitives/SeverityIcon.svelte';
	import { getLocaleContext } from '$lib/i18n/localeContext.svelte';

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
		/**
		 * See `createSolvingIndicator`. The live panel would only paint once the solve is over, so
		 * an Esc hint stands in for it; the result's messages still show.
		 */
		freezesDuringSolve?: boolean;
		/** `floating` overlays the bottom centre; `inline` sits in the flow below the host's content. */
		placement?: 'floating' | 'inline';
	}

	let {
		live,
		phase: sessionPhase,
		diagnostics = [],
		onabort,
		onconfirm,
		ondiscard,
		freezesDuringSolve = false,
		placement = 'floating'
	}: Props = $props();

	const locale = getLocaleContext();
	const t = $derived(locale.messages);

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
	// glitch, not as progress. Once shown, it stays long enough to read and ends on a full bar
	// ("finishing"), so a solve just past the reveal does not blink the panel away mid-bar. A
	// result that needs an answer (review, blocked) replaces it at once instead.
	const LIVE_REVEAL_MS = 300;
	const LIVE_MIN_VISIBLE_MS = 400;
	const FINISH_MS = 200;
	let revealed = $state(false);
	let finishing = $state(false);
	let revealedAt = 0;
	$effect(() => {
		if (phase === 'live') {
			finishing = false;
			if (freezesDuringSolve) return;
			const timer = setTimeout(() => {
				revealed = true;
				revealedAt = performance.now();
			}, LIVE_REVEAL_MS);
			return () => clearTimeout(timer);
		}
		if (!untrack(() => revealed) || phase !== 'idle') {
			revealed = false;
			finishing = false;
			return;
		}
		finishing = true;
		const hold = Math.max(FINISH_MS, LIVE_MIN_VISIBLE_MS - (performance.now() - revealedAt));
		const timer = setTimeout(() => {
			revealed = false;
			finishing = false;
		}, hold);
		return () => clearTimeout(timer);
	});

	// What the panel is showing, which lags the session while a finished solve's panel winds down.
	const view = $derived<Phase>(finishing ? 'live' : phase);

	// While solving, the live channel is all there is. Once the result lands it is authoritative
	// — it carries remarks too — so the live list is dropped entirely and nothing is shown twice.
	const rows = $derived<SolveDiagnostic[]>(
		view === 'live' ? [...live.diagnostics] : view === 'idle' ? authoredRemarks : authoredGating
	);

	// A remark states something without asking anything, so it reads as a quiet note.
	const issues = $derived<Issue[]>(
		rows.map((d) => ({
			severity: d.level === 'remark' ? 'note' : d.level,
			message: d.message,
			source: d.source
		}))
	);

	// Steps a few milliseconds long would swap the headline faster than it can be read. Each one
	// stays up for at least this long; steps that end sooner are skipped in the label but still
	// count in the bar. The label and its step count move together so they never disagree.
	const HEADLINE_MIN_MS = 200;
	let headline = $state.raw<(typeof progress)[number] | undefined>(undefined);
	let headlineAt = 0;
	$effect(() => {
		const next = progress[0];
		const shown = untrack(() => headline);
		if (next?.label === shown?.label && next?.done === shown?.done) {
			headline = next;
			return;
		}
		const show = () => {
			headline = next;
			headlineAt = performance.now();
		};
		const wait = HEADLINE_MIN_MS - (performance.now() - headlineAt);
		if (!shown || wait <= 0) {
			show();
			return;
		}
		const timer = setTimeout(show, wait);
		return () => clearTimeout(timer);
	});

	const visible = $derived(
		view === 'review' || view === 'blocked'
			? true
			: view === 'live'
				? revealed && (rows.length > 0 || progress.length > 0)
				: rows.length > 0 && lingering
	);

	// What a screen reader hears of the passive views, through a region that outlives the panel: one
	// created together with its text is not announced. The step name, not its counter, so a long
	// solve announces each step rather than every tick. Review and blocked are alerts of their own.
	const announcement = $derived(
		!visible
			? ''
			: view === 'live'
				? ((headline ?? progress[0])?.label ?? t.solveSolving)
				: view === 'idle'
					? rows.map((d) => d.message).join(' ')
					: ''
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

<div class="sr-only" role="status" aria-live="polite">{announcement}</div>

{#if freezesDuringSolve && view === 'live'}
	<!-- Painted before the solve takes the thread; Abort could not be clicked until it ends. Inline,
	     the solving chip carries the hint instead: a line here would resize the footer mid-solve. -->
	{#if placement === 'floating'}
		<p
			class="bottom-4 text-xs fixed left-1/2 z-50 -translate-x-1/2 text-muted-foreground"
			data-testid="solve-esc-hint"
		>
			{t.solveMessagesEscHint}
		</p>
	{/if}
{:else if visible}
	<div
		class="p-3 border {placement === 'inline'
			? 'mt-3 rounded-md bg-muted/40'
			: 'bottom-4 shadow-lg w-lg fixed left-1/2 z-50 max-w-screen-inset -translate-x-1/2 rounded-lg bg-background'} {view ===
		'blocked'
			? 'border-destructive/50'
			: ''}"
		role={view === 'review' || view === 'blocked' ? 'alert' : undefined}
		data-testid="solve-messages"
		data-view={view}
	>
		{#if view === 'live'}
			{@const head = headline ?? progress[0]}
			<div>
				<div>
					<div class="gap-2 flex items-center">
						<LoaderCircle class="h-4 w-4 animate-spin shrink-0 text-muted-foreground" />
						<span class="min-w-0 text-sm flex-1 truncate">{head?.label ?? t.solveSolving}</span>
						{#if head?.done !== undefined && head?.total !== undefined}
							<span class="text-xs shrink-0 text-muted-foreground tabular-nums">
								{head.done} / {head.total}
							</span>
						{/if}
						<Button
							variant="secondary"
							size="xs"
							class="-my-1 shrink-0"
							disabled={finishing}
							onclick={onabort}
						>
							{t.solveMessagesAbort}
						</Button>
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
								aria-label={p.label ?? p.source ?? t.solveSolving}
								aria-valuemin={0}
								aria-valuemax={100}
								aria-valuenow={p.fraction !== undefined ? Math.round(p.fraction * 100) : undefined}
							>
								{#if p.fraction !== undefined}
									{@const bar = finishing
										? { width: 1, ms: FINISH_MS }
										: (bars[p.source ?? ''] ?? { width: p.fraction, ms: 150 })}
									<div
										class="h-full w-(--bar-width) rounded-full bg-primary transition-all duration-(--bar-ms) ease-linear"
										style:--bar-width="{bar.width * 100}%"
										style:--bar-ms="{bar.ms}ms"
									></div>
								{:else}
									<div class="animate-pulse h-full w-1/3 rounded-full bg-primary/60"></div>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</div>
		{:else if view === 'review' || view === 'blocked'}
			<div class="mb-2">
				<div class="gap-2 text-sm font-medium flex items-center">
					{#if view === 'blocked'}
						<SeverityIcon severity="error" />
						{t.solveBlockedTitle}
					{:else}
						<SeverityIcon severity="warning" />
						{t.solveMessagesTitle}
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">
					{view === 'blocked' ? t.solveBlocked : t.solveMessagesDescription}
				</p>
			</div>
		{/if}

		{#if rows.length > 0}
			<div class="max-h-40 overflow-y-auto {view === 'live' ? 'mt-3 pt-3 border-t' : ''}">
				<IssueList {issues} variant="plain" />
			</div>
		{/if}

		{#if view === 'review' || view === 'blocked'}
			<div class="mt-3 gap-2 flex justify-end">
				{#if view === 'blocked'}
					<Button variant="outline" size="sm" onclick={dismiss}>{t.solveMessagesDismiss}</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={ondiscard}>{t.solveMessagesDiscard}</Button>
					<Button size="sm" onclick={onconfirm}>{t.solveMessagesConfirm}</Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
