<script lang="ts">
	// The one place a solve talks to the user.
	//
	// Only a Selva Message component interrupts: the author wrote that text for whoever is using
	// the app. Grasshopper's own warnings are about the definition, not the result, and go to the
	// footer log instead — interrupting for them trains people to dismiss the one that mattered.
	//
	// While the solve runs the panel is fed by live events and offers Abort. When it ends the
	// reported result replaces them outright — it lists the same messages, remarks included — so
	// nothing is ever shown twice.
	//
	// Of those, only warnings and errors get buttons. A remark states something without asking
	// anything, so it appears on its own after the solve and fades.

	import { CircleAlert, TriangleAlert, Info, LoaderCircle } from '@lucide/svelte';
	import type { SolveEvent } from '@selvajs/schemas';
	import type { SolveDiagnostic } from '@selvajs/solve/shared';
	import { Button } from '$lib/components/primitives/button';

	interface Props {
		/** What the running (or most recent) solve has said over the live channel. */
		events: SolveEvent[];
		solving: boolean;
		/** The last result's messages, with level, source and `isGate`. */
		diagnostics?: SolveDiagnostic[];
		/** The definition refused the solve (or it was aborted): already applied as no result. */
		blocked?: boolean;
		/** The last result is held back until the user continues or discards it. */
		awaitingAck?: boolean;
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
		events,
		solving,
		diagnostics = [],
		blocked = false,
		awaitingAck = false,
		onabort,
		onconfirm,
		ondiscard,
		labels = DEFAULT_LABELS
	}: Props = $props();

	const REMARK_LINGER_MS = 6000;

	function toLevel(level: string | undefined): SolveDiagnostic['level'] {
		return level === 'error' || level === 'warning' ? level : 'remark';
	}

	const liveDiagnostics = $derived<SolveDiagnostic[]>(
		events
			.filter((e) => e.type === 'diagnostic' && e.payload)
			.map((e) => {
				const d = e.payload as Partial<SolveDiagnostic> & { level?: string };
				return {
					level: toLevel(d.level),
					message: d.message ?? '',
					...(d.source ? { source: d.source } : {}),
					...(d.isGate ? { isGate: true as const } : {})
				};
			})
	);
	// Grasshopper's own complaints stay in the footer log; this panel shows what the author wrote.
	const authored = $derived(diagnostics.filter((d) => d.isGate));

	// A remark states something without asking anything, so it never belongs next to
	// Discard/Continue — the buttons would imply it is part of what the user is deciding. It gets
	// the quiet treatment instead: shown alone after the solve, then faded.
	const authoredGating = $derived(authored.filter((d) => d.level !== 'remark'));
	const authoredRemarks = $derived(authored.filter((d) => d.level === 'remark'));

	let dismissedFor = $state.raw<SolveDiagnostic[] | null>(null);

	type Phase = 'live' | 'review' | 'blocked' | 'idle';
	const phase = $derived<Phase>(
		solving
			? 'live'
			: awaitingAck
				? 'review'
				: blocked && dismissedFor !== diagnostics
					? 'blocked'
					: 'idle'
	);

	// While solving, the live channel is all there is. Once the result lands it is authoritative
	// — it carries remarks too — so the live list is dropped entirely and nothing is shown twice.
	const rows = $derived<SolveDiagnostic[]>(
		phase === 'live' ? liveDiagnostics : phase === 'idle' ? authoredRemarks : authoredGating
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

	const visible = $derived(
		phase === 'review' || phase === 'blocked'
			? true
			: rows.length > 0 && (phase === 'live' || lingering)
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
			<div class="mb-2 gap-2 text-xs flex items-center text-muted-foreground">
				<LoaderCircle class="h-3.5 w-3.5 animate-spin" />
				{labels.solving}
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

		<ul class="max-h-40 space-y-2 text-sm overflow-y-auto">
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

		{#if phase !== 'idle'}
			<div class="mt-3 gap-2 flex justify-end">
				{#if phase === 'live'}
					<Button variant="outline" size="sm" onclick={onabort}>{labels.abort}</Button>
				{:else if phase === 'blocked'}
					<Button variant="outline" size="sm" onclick={dismiss}>{labels.dismiss}</Button>
				{:else}
					<Button variant="outline" size="sm" onclick={ondiscard}>{labels.discard}</Button>
					<Button size="sm" onclick={onconfirm}>{labels.confirm}</Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}
