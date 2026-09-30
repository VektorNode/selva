import { describe, it, expect } from 'vitest';
import { liveOwnerKey, solveEndedKind } from '../liveSolve.server';

describe('liveOwnerKey', () => {
	it('is the user, and nothing for a caller without one', () => {
		expect(liveOwnerKey('u1')).toBe('user:u1');
		expect(liveOwnerKey(null)).toBeNull();
		expect(liveOwnerKey('')).toBeNull();
	});
});

describe('solveEndedKind', () => {
	const ok = (outcome?: unknown) => ({
		kind: 'ok',
		envelope: { result: outcome === undefined ? {} : { selva: { outcome } } }
	});

	it("reads a completed solve's verdict from the selva block", () => {
		expect(solveEndedKind(ok())).toBe('ok');
		expect(solveEndedKind(ok({ diagnostics: [], blocked: true, aborted: false }))).toBe('blocked');
		expect(solveEndedKind(ok({ diagnostics: [], blocked: true, aborted: true }))).toBe('aborted');
	});

	it('maps the failures', () => {
		expect(solveEndedKind({ kind: 'client_abort' })).toBe('aborted');
		expect(solveEndedKind({ kind: 'timeout' })).toBe('aborted');
		expect(solveEndedKind({ kind: 'shed' })).toBe('error');
		expect(solveEndedKind({ kind: 'compute_error' })).toBe('error');
	});
});
