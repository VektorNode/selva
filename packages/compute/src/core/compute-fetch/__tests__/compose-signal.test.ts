import { describe, expect, it, vi } from 'vitest';
import { composeSignal } from '../signal';

describe('composeSignal', () => {
	it('returns undefined signal when no caller signal and no timeout', () => {
		const { signal, cleanup } = composeSignal(undefined, undefined);
		expect(signal).toBeUndefined();
		expect(() => cleanup()).not.toThrow();
	});

	it('returns the caller signal itself when no timeout is requested', () => {
		const callerCtrl = new AbortController();
		const { signal } = composeSignal(callerCtrl.signal, undefined);
		expect(signal).toBe(callerCtrl.signal);
	});

	// An app that reuses one AbortController across many solves must not accumulate a
	// registration per attempt on it.
	it('cleanup detaches from the caller signal, across many calls', () => {
		const callerCtrl = new AbortController();
		const callerSignal = callerCtrl.signal;

		const addSpy = vi.spyOn(callerSignal, 'addEventListener');
		const removeSpy = vi.spyOn(callerSignal, 'removeEventListener');

		for (let i = 0; i < 50; i++) {
			const { cleanup } = composeSignal(callerSignal, 5000);
			cleanup();
		}

		const adds = addSpy.mock.calls.filter(([type]) => type === 'abort').length;
		const removes = removeSpy.mock.calls.filter(([type]) => type === 'abort').length;
		expect(adds).toBe(removes);
		expect(adds).toBeGreaterThan(0);
	});

	it('after cleanup, a caller abort no longer propagates to the composed signal', () => {
		const callerCtrl = new AbortController();
		const { signal, cleanup } = composeSignal(callerCtrl.signal, 5000);
		cleanup();
		callerCtrl.abort();
		expect(signal?.aborted).toBe(false);
	});

	it('forwards the caller abort (with its reason) before cleanup', () => {
		const callerCtrl = new AbortController();
		const { signal } = composeSignal(callerCtrl.signal, 5000);
		const reason = new Error('caller cancelled');
		callerCtrl.abort(reason);
		expect(signal?.aborted).toBe(true);
		expect(signal?.reason).toBe(reason);
	});

	it('inherits an already-aborted caller signal with its reason, without leaking listeners', () => {
		const ctrl = new AbortController();
		const reason = new Error('already gone');
		ctrl.abort(reason);
		const addSpy = vi.spyOn(ctrl.signal, 'addEventListener');
		const removeSpy = vi.spyOn(ctrl.signal, 'removeEventListener');

		const { signal, cleanup } = composeSignal(ctrl.signal, 5000);
		expect(signal?.aborted).toBe(true);
		expect(signal?.reason).toBe(reason);
		cleanup();

		const adds = addSpy.mock.calls.filter(([t]) => t === 'abort').length;
		const removes = removeSpy.mock.calls.filter(([t]) => t === 'abort').length;
		expect(removes).toBeGreaterThanOrEqual(adds);
	});
});
