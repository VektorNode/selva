import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readPersisted } from '../usePersisted.svelte';

describe('readPersisted', () => {
	let store: Map<string, string>;

	beforeEach(() => {
		store = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => store.set(key, value)
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns the stored value when it has the same shape', () => {
		store.set('k', JSON.stringify({ a: true }));
		expect(readPersisted('k', {})).toEqual({ a: true });
	});

	it('falls back to initial for a stored null against an object', () => {
		store.set('k', 'null');
		expect(readPersisted<Record<string, boolean>>('k', {})).toEqual({});
	});

	it('falls back to initial when an array is stored for an object', () => {
		store.set('k', '[]');
		expect(readPersisted('k', {})).toEqual({});
	});

	it('falls back to initial when nothing is stored or storage throws', () => {
		expect(readPersisted('missing', 'none')).toBe('none');
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('denied');
			}
		});
		expect(readPersisted('k', 'none')).toBe('none');
	});
});
