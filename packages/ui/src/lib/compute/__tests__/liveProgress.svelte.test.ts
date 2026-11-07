import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProgressPayload } from '@selvajs/schemas';
import { EMPTY_LIVE_SOLVE, type LiveSolveState } from '@selvajs/solve/client';

import { createLiveProgress } from '../liveProgress.svelte';

const FRAME_MS = 16;

function liveWith(...reports: ProgressPayload[]): LiveSolveState {
	return { ...EMPTY_LIVE_SOLVE, progress: new Map(reports.map((r) => [r.source ?? '', r])) };
}

function mount() {
	let live = $state.raw(EMPTY_LIVE_SOLVE);
	let progress!: ReturnType<typeof createLiveProgress>;
	const destroy = $effect.root(() => {
		progress = createLiveProgress(() => live);
	});
	flushSync();
	return {
		progress,
		destroy,
		setLive(next: LiveSolveState) {
			live = next;
			flushSync();
		}
	};
}

function advance(ms: number) {
	vi.advanceTimersByTime(ms);
	flushSync();
}

describe('createLiveProgress', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
		vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
			setTimeout(() => cb(performance.now()), FRAME_MS)
		);
		vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it('lists the newest report per source', () => {
		const { progress, setLive, destroy } = mount();
		const a = { source: 'a', fraction: 0.2 };
		const b = { source: 'b', fraction: 0.7 };

		setLive(liveWith(a, b));

		expect(progress.progress).toEqual([a, b]);
		destroy();
	});

	it('snaps a bar to its fraction, then eases it to the step end after two frames', () => {
		const { progress, setLive, destroy } = mount();

		setLive(liveWith({ source: 'a', fraction: 0.2, nextFraction: 0.5, stepMs: 1000 }));
		expect(progress.bars.a).toEqual({ width: 0.2, ms: 150 });

		// The snapped width has to paint before the eased one is set, or nothing transitions.
		advance(FRAME_MS);
		expect(progress.bars.a).toEqual({ width: 0.2, ms: 150 });
		advance(FRAME_MS);
		expect(progress.bars.a).toEqual({ width: 0.5, ms: 1000 });
		destroy();
	});

	it('leaves an easing bar alone when another source reports', () => {
		const { progress, setLive, destroy } = mount();
		const a = { source: 'a', fraction: 0.2, nextFraction: 0.5, stepMs: 1000 };

		setLive(liveWith(a));
		advance(FRAME_MS * 2);
		setLive(liveWith(a, { source: 'b', fraction: 0.1 }));

		expect(progress.bars.a).toEqual({ width: 0.5, ms: 1000 });
		expect(progress.bars.b).toEqual({ width: 0.1, ms: 150 });
		destroy();
	});

	it('holds each headline long enough to read', () => {
		const { progress, setLive, destroy } = mount();

		setLive(liveWith({ label: 'Meshing' }));
		expect(progress.headline?.label).toBe('Meshing');

		advance(50);
		setLive(liveWith({ label: 'Baking' }));
		expect(progress.headline?.label).toBe('Meshing');

		advance(150);
		expect(progress.headline?.label).toBe('Baking');
		destroy();
	});

	it('updates the shown headline in place when only its fraction moves', () => {
		const { progress, setLive, destroy } = mount();

		setLive(liveWith({ label: 'Meshing', fraction: 0.1 }));
		setLive(liveWith({ label: 'Meshing', fraction: 0.4 }));

		expect(progress.headline?.fraction).toBe(0.4);
		destroy();
	});
});
