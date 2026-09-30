import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	SOLVE_EVENT_KINDS,
	solveEventCoalesceKey,
	solveEventDelivery
} from '../solve-event-kinds.js';

// The C# table (SolveEventKindsTests) is compared against the same file.
const fixture = JSON.parse(
	readFileSync(new URL('../../fixtures/solve/event-kinds.json', import.meta.url), 'utf8')
);

describe('SOLVE_EVENT_KINDS', () => {
	it('matches the cross-stack fixture', () => {
		expect(SOLVE_EVENT_KINDS).toEqual(fixture);
	});

	it('treats an unknown kind as bestEffort, never coalesced', () => {
		expect(solveEventDelivery('valueListUpdated')).toBe('bestEffort');
		expect(solveEventCoalesceKey({ type: 'valueListUpdated', payload: {} })).toBeNull();
	});

	it('keys progress by source', () => {
		const key = (source?: string) =>
			solveEventCoalesceKey({ type: 'progress', payload: source ? { source } : {} });
		expect(key('mesh')).toBe('progress:mesh');
		expect(key('mesh')).not.toBe(key('export'));
		expect(key()).toBe('progress:');
	});

	it('never coalesces a critical kind', () => {
		expect(solveEventCoalesceKey({ type: 'diagnostic', payload: { source: 'x' } })).toBeNull();
	});
});
