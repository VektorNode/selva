import { describe, expect, it } from 'vitest';
import type { SolveEvent } from '@selvajs/schemas';
import { EMPTY_LIVE_SOLVE, reduceLiveSolve, type LiveSolveState } from '../events/live-solve.js';

let seq = 0;
function ev(type: string, payload: Record<string, unknown> = {}, solveId = 's1'): SolveEvent {
	return { solveId, seq: ++seq, at: '2026-01-01T00:00:00Z', type, payload };
}
const fold = (events: SolveEvent[], from: LiveSolveState = EMPTY_LIVE_SOLVE) =>
	events.reduce(reduceLiveSolve, from);

describe('reduceLiveSolve', () => {
	it('runs from solveStarted to solveEnded and keeps the end kind', () => {
		seq = 0;
		const running = fold([ev('solveStarted')]);
		expect(running).toMatchObject({ solveId: 's1', running: true, ended: null });
		expect(fold([ev('solveEnded', { kind: 'aborted' })], running)).toMatchObject({
			running: false,
			ended: { kind: 'aborted' }
		});
	});

	it('normalizes diagnostics like a finished solve', () => {
		seq = 0;
		const state = fold([
			ev('diagnostic', { level: 'warning', message: ' Too thin ', source: null, isGate: true })
		]);
		expect(state.diagnostics).toEqual([{ level: 'warning', message: 'Too thin', isGate: true }]);
	});

	it('keeps the newest progress per source', () => {
		seq = 0;
		const state = fold([
			ev('progress', { source: 'mesh', fraction: 0.2 }),
			ev('progress', { source: 'export', fraction: 1.5, label: 'Writing' }),
			ev('progress', { source: 'mesh', fraction: 0.6 })
		]);
		expect(state.progress.get('mesh')).toEqual({ source: 'mesh', fraction: 0.6 });
		expect(state.progress.get('export')).toEqual({
			source: 'export',
			fraction: 1,
			label: 'Writing'
		});
	});

	it('keeps the running step’s end point and last duration', () => {
		const state = fold([
			ev('progress', { source: 'steps', fraction: 0.2, nextFraction: 1.4, stepMs: 800 })
		]);
		expect(state.progress.get('steps')).toEqual({
			source: 'steps',
			fraction: 0.2,
			nextFraction: 1,
			stepMs: 800
		});
	});

	it('never moves a bar backwards within a solve', () => {
		const state = fold([
			ev('progress', { source: 'steps', fraction: 0.6, label: 'a' }),
			ev('progress', { source: 'steps', fraction: 0.4, label: 'b' })
		]);
		expect(state.progress.get('steps')).toEqual({ source: 'steps', fraction: 0.6, label: 'b' });
	});

	it('resets on a new solve id and passes unknown kinds through', () => {
		seq = 0;
		const first = fold([
			ev('diagnostic', { level: 'error', message: 'x' }),
			ev('valueListUpdated')
		]);
		expect(first.other.map((e) => e.type)).toEqual(['valueListUpdated']);
		const second = fold([ev('solveStarted', {}, 's2')], first);
		expect(second).toMatchObject({ solveId: 's2', running: true, diagnostics: [], other: [] });
	});

	it('ignores a repeated or late delivery, returning the same state', () => {
		seq = 0;
		const a = ev('diagnostic', { level: 'error', message: 'x' });
		const state = fold([a]);
		expect(reduceLiveSolve(state, a)).toBe(state);
	});
});
