import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	getExternalInputs,
	writeExternalValue,
	readExternalValue,
	clearExternalValue
} from '../external-storage.js';
import type { UISchema } from '@selvajs/schemas';

// getExternalInputs is the gate the whole client-input feature hangs on: it decides
// which inputs a producer route must fill. These pin the source.kind === 'client'
// filter and the displayName fallback. The read/write helpers are also covered with a
// sessionStorage stub, including the no-storage guard (SSR / node).

const input = (paramId: string, opts: { displayName?: string; source?: { kind: string } } = {}) =>
	({ type: 'input', paramId, ...opts }) as never;

function schema(items: unknown[]): UISchema {
	return {
		layout: { type: 'flat', groups: [{ id: 'g', label: 'g', items }] }
	} as unknown as UISchema;
}

describe('getExternalInputs', () => {
	it('keeps only inputs with source.kind === client', () => {
		const s = schema([
			input('a', { source: { kind: 'client' } }),
			input('b', { source: { kind: 'user' } }),
			input('c')
		]);
		expect(getExternalInputs(s).map((e) => e.paramId)).toEqual(['a']);
	});

	it('falls back to paramId when displayName is absent', () => {
		const s = schema([input('a', { source: { kind: 'client' } })]);
		expect(getExternalInputs(s)[0].displayName).toBe('a');
	});

	it('uses displayName when present', () => {
		const s = schema([input('a', { displayName: 'Width', source: { kind: 'client' } })]);
		expect(getExternalInputs(s)[0].displayName).toBe('Width');
	});
});

describe('read/write/clear with a sessionStorage stub', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubStorage() {
		const store = new Map<string, string>();
		vi.stubGlobal('sessionStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v),
			removeItem: (k: string) => store.delete(k)
		});
		return store;
	}

	it('round-trips a value scoped by (scopeKey, inputId)', () => {
		const store = stubStorage();
		writeExternalValue({ scopeKey: 's1', inputId: 'p1', value: { x: 1 } });
		expect(readExternalValue({ scopeKey: 's1', inputId: 'p1' })).toEqual({ x: 1 });
		expect(store.has('external:s1:p1')).toBe(true);
	});

	it('scopes values so they do not bleed across scopeKey', () => {
		stubStorage();
		writeExternalValue({ scopeKey: 's1', inputId: 'p1', value: 'a' });
		expect(readExternalValue({ scopeKey: 's2', inputId: 'p1' })).toBeUndefined();
	});

	it('clear removes the value', () => {
		stubStorage();
		writeExternalValue({ scopeKey: 's1', inputId: 'p1', value: 'a' });
		clearExternalValue({ scopeKey: 's1', inputId: 'p1' });
		expect(readExternalValue({ scopeKey: 's1', inputId: 'p1' })).toBeUndefined();
	});

	it('returns undefined for malformed JSON', () => {
		const store = stubStorage();
		store.set('external:s1:p1', '{not json');
		expect(readExternalValue({ scopeKey: 's1', inputId: 'p1' })).toBeUndefined();
	});
});

describe('no-storage guard (SSR / node)', () => {
	it('read returns undefined and write/clear no-op when sessionStorage is absent', () => {
		expect(readExternalValue({ scopeKey: 's1', inputId: 'p1' })).toBeUndefined();
		expect(() => writeExternalValue({ scopeKey: 's1', inputId: 'p1', value: 1 })).not.toThrow();
		expect(() => clearExternalValue({ scopeKey: 's1', inputId: 'p1' })).not.toThrow();
	});

	it('ignores empty scopeKey or inputId', () => {
		expect(readExternalValue({ scopeKey: '', inputId: 'p1' })).toBeUndefined();
		expect(readExternalValue({ scopeKey: 's1', inputId: '' })).toBeUndefined();
	});
});
