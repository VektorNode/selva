import { describe, it, expect } from 'vitest';
import { MAX_EVENTS_PER_POST, parseCallbackEvents, readBearer } from '../ingest.server';

describe('parseCallbackEvents', () => {
	it('keeps well-formed events, stamps a missing at, and ignores seq and solveId', () => {
		expect(
			parseCallbackEvents(
				{
					events: [
						{ type: 'diagnostic', at: 'a', payload: { level: 'error' }, seq: 9, solveId: 'x' },
						{ type: 'progress' }
					]
				},
				'now'
			)
		).toEqual([
			{ type: 'diagnostic', at: 'a', payload: { level: 'error' } },
			{ type: 'progress', at: 'now' }
		]);
	});

	it('drops what it cannot use instead of refusing the batch', () => {
		expect(
			parseCallbackEvents(
				{ events: [null, 7, { type: '' }, { type: 'x', payload: [1] }, { type: 'y' }] },
				'now'
			)
		).toEqual([
			{ type: 'x', at: 'now' },
			{ type: 'y', at: 'now' }
		]);
		expect(parseCallbackEvents({ events: 'nope' }, 'now')).toEqual([]);
		expect(parseCallbackEvents(null, 'now')).toEqual([]);
	});

	it('caps a batch', () => {
		const events = Array.from({ length: MAX_EVENTS_PER_POST + 10 }, () => ({ type: 'x' }));
		expect(parseCallbackEvents({ events }, 'now')).toHaveLength(MAX_EVENTS_PER_POST);
	});
});

describe('readBearer', () => {
	it('reads only a Bearer token', () => {
		const req = (auth?: string) =>
			new Request('http://x', auth ? { headers: { authorization: auth } } : {});
		expect(readBearer(req('Bearer abc '))).toBe('abc');
		expect(readBearer(req('Basic abc'))).toBeNull();
		expect(readBearer(req())).toBeNull();
	});
});
