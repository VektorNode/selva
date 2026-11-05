import { describe, expect, it, vi } from 'vitest';
import type { SolveSettlement } from '@selvajs/solve/client';
import { runPanelAction } from '../run-panel-action';

const applied: SolveSettlement = {
	status: 'applied',
	result: { outputs: { out: 1 } },
	diagnostics: []
};

describe('runPanelAction', () => {
	it('runs a plain action straight away, without solving', async () => {
		const ensureSolved = vi.fn();
		const onclick = vi.fn();
		await runPanelAction({ id: 'a', label: 'A', onclick }, ensureSolved);
		expect(ensureSolved).not.toHaveBeenCalled();
		expect(onclick).toHaveBeenCalledWith();
	});

	it('hands a solvesFirst action the applied result', async () => {
		const onclick = vi.fn();
		await runPanelAction({ id: 'a', label: 'A', solvesFirst: true, onclick }, async () => applied);
		expect(onclick).toHaveBeenCalledWith(applied);
	});

	it('skips a solvesFirst action when the solve did not apply', async () => {
		const onclick = vi.fn();
		for (const settled of [
			{ status: 'blocked', diagnostics: [] },
			{ status: 'discarded', diagnostics: [] },
			{ status: 'aborted', diagnostics: [] },
			{ status: 'failed', error: 'down' }
		] satisfies SolveSettlement[]) {
			await runPanelAction(
				{ id: 'a', label: 'A', solvesFirst: true, onclick },
				async () => settled
			);
		}
		expect(onclick).not.toHaveBeenCalled();
	});

	it('runs a solvesFirst action anyway where the host cannot solve', async () => {
		const onclick = vi.fn();
		await runPanelAction({ id: 'a', label: 'A', solvesFirst: true, onclick }, undefined);
		expect(onclick).toHaveBeenCalledWith();
	});
});
