import { untrack } from 'svelte';
import type { ProgressPayload } from '@selvajs/schemas';
import type { LiveSolveState } from '@selvajs/solve/client';

/** A progress bar's width (0–1) and how long its transition to that width runs. */
export interface ProgressBar {
	width: number;
	ms: number;
}

/**
 * The live channel's progress reports, smoothed for display. `headline` is the first source's
 * report, held long enough to read; `bars` is the width each source's bar should animate to.
 */
export function createLiveProgress(getLive: () => LiveSolveState): {
	readonly progress: ProgressPayload[];
	readonly headline: ProgressPayload | undefined;
	readonly bars: Readonly<Record<string, ProgressBar>>;
} {
	const progress = $derived([...getLive().progress.values()]);

	// A report only arrives when a step starts, so a bar that just shows `fraction` stands still
	// through the step and then jumps. When the plugin knows how long the step took last time, the
	// bar runs linearly to where the step will end, over that time. Steps are weighted by time, so
	// linear gives one steady speed across the solve; any easing curve visibly speeds up and
	// crawls within each step. A slower run waits at the step's end; a faster one snaps ahead.
	let bars = $state.raw<Record<string, ProgressBar>>({});
	// Any live event re-runs the effect below. Only a source with a new report may re-snap;
	// the rest keep easing where they are.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- bookkeeping for the effect below, never rendered
	let seen = new Map<string, unknown>();
	let targets: Record<string, ProgressBar> = {};
	$effect(() => {
		const snapped: Record<string, ProgressBar> = {};
		const eased: Record<string, ProgressBar> = {};
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

	// Steps a few milliseconds long would swap the headline faster than it can be read. Each one
	// stays up for at least this long; steps that end sooner are skipped in the label but still
	// count in the bar. The label and its step count move together so they never disagree.
	const HEADLINE_MIN_MS = 200;
	let headline = $state.raw<ProgressPayload | undefined>(undefined);
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

	return {
		get progress() {
			return progress;
		},
		get headline() {
			return headline;
		},
		get bars() {
			return bars;
		}
	};
}
