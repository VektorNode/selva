import { describe, expect, it } from 'vitest';
import { validateUniqueSourceKeys, getDuplicateSourceKeyParamIds } from './validation';
import type { UISchema } from '@selvajs/schemas';

// validateUniqueSourceKeys walks the layout (both kinds) and flags any non-user input
// whose source.key collides with an earlier input's key — that ambiguity would make the
// host unable to tell which input a producer/fetch feeds.

const input = (paramId: string, source?: Record<string, unknown>) =>
	({ id: paramId, type: 'input', paramId, widgetType: 'number', source }) as never;

const group = (id: string, items: unknown[]) => ({ id, label: id, items, order: 0 }) as never;

function flat(items: unknown[]): UISchema {
	return {
		layout: { type: 'flat', groups: [group('g1', items)] },
		inputs: [],
		outputs: []
	} as unknown as UISchema;
}

describe('validateUniqueSourceKeys', () => {
	it('returns no issues when all client/server keys are distinct', () => {
		const schema = flat([
			input('a', { kind: 'client', key: 'line-app' }),
			input('b', { kind: 'server', key: 'capture.geometry' })
		]);
		expect(validateUniqueSourceKeys(schema)).toEqual([]);
	});

	it('flags the second input that reuses a key', () => {
		const schema = flat([
			input('a', { kind: 'client', key: 'line-app' }),
			input('b', { kind: 'client', key: 'line-app' })
		]);
		const issues = validateUniqueSourceKeys(schema);
		expect(issues).toHaveLength(1);
		expect(issues[0].paramId).toBe('b');
		expect(issues[0].key).toBe('line-app');
	});

	it('treats a key as a collision regardless of kind', () => {
		const schema = flat([
			input('a', { kind: 'client', key: 'shared' }),
			input('b', { kind: 'server', key: 'shared' })
		]);
		expect(validateUniqueSourceKeys(schema)).toHaveLength(1);
	});

	it('ignores user inputs and inputs without a key', () => {
		const schema = flat([
			input('a'),
			input('b', { kind: 'user' }),
			input('c', { kind: 'client' }),
			input('d', { kind: 'client', key: '   ' })
		]);
		expect(validateUniqueSourceKeys(schema)).toEqual([]);
	});

	it('matches keys across groups and tabs', () => {
		const schema = {
			layout: {
				type: 'tabbed',
				tabs: [
					{ id: 't1', groups: [group('g1', [input('a', { kind: 'client', key: 'x' })])] },
					{ id: 't2', groups: [group('g2', [input('b', { kind: 'client', key: 'x' })])] }
				]
			},
			inputs: [],
			outputs: []
		} as unknown as UISchema;
		expect(validateUniqueSourceKeys(schema)).toHaveLength(1);
	});
});

describe('getDuplicateSourceKeyParamIds', () => {
	it('returns every input on a colliding key, including the first', () => {
		const schema = flat([
			input('a', { kind: 'client', key: 'dup' }),
			input('b', { kind: 'client', key: 'dup' }),
			input('c', { kind: 'client', key: 'unique' })
		]);
		const ids = getDuplicateSourceKeyParamIds(schema);
		expect(ids.has('a')).toBe(true);
		expect(ids.has('b')).toBe(true);
		expect(ids.has('c')).toBe(false);
	});

	it('returns an empty set when all keys are distinct', () => {
		const schema = flat([
			input('a', { kind: 'client', key: 'x' }),
			input('b', { kind: 'server', key: 'y' })
		]);
		expect(getDuplicateSourceKeyParamIds(schema).size).toBe(0);
	});
});
