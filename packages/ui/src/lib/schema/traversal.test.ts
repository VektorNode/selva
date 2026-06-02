import { describe, expect, it } from 'vitest';
import { getGroups, getLayoutItems, getInputItems } from '@selvajs/schemas';
import type { UISchema } from '@selvajs/schemas';

// These pin the layout-union discrimination (tabbed vs flat) and the defensive contract
// (missing layout / groups / items yield empty, never throw), since this module is the
// single place every caller relies on to walk a schema.

const input = (id: string, source?: { kind: string }) =>
	({ type: 'input', paramId: id, displayName: id, ...(source ? { source } : {}) }) as never;
const linebreak = (id: string) => ({ type: 'linebreak', id }) as never;
const group = (id: string, items: unknown[]) => ({ id, label: id, items }) as never;

function schema(layout: unknown): UISchema {
	return { layout } as unknown as UISchema;
}

describe('getGroups — layout discrimination', () => {
	it('flattens tabs into a single group list, tab order preserved', () => {
		const s = schema({
			type: 'tabbed',
			tabs: [
				{ id: 't1', label: 't1', groups: [group('g1', []), group('g2', [])] },
				{ id: 't2', label: 't2', groups: [group('g3', [])] }
			]
		});
		expect(getGroups(s).map((g) => g.id)).toEqual(['g1', 'g2', 'g3']);
	});

	it('returns flat groups directly', () => {
		const s = schema({ type: 'flat', groups: [group('g1', []), group('g2', [])] });
		expect(getGroups(s).map((g) => g.id)).toEqual(['g1', 'g2']);
	});
});

describe('getGroups — defensive contract', () => {
	it('returns [] when layout is missing', () => {
		expect(getGroups({} as UISchema)).toEqual([]);
	});

	it('returns [] for an unknown layout type', () => {
		expect(getGroups(schema({ type: 'mystery' }))).toEqual([]);
	});

	it('tolerates missing tabs / groups arrays', () => {
		expect(getGroups(schema({ type: 'tabbed' }))).toEqual([]);
		expect(getGroups(schema({ type: 'flat' }))).toEqual([]);
	});

	it('tolerates a tab with no groups', () => {
		const s = schema({ type: 'tabbed', tabs: [{ id: 't1', label: 't1' }] });
		expect(getGroups(s)).toEqual([]);
	});
});

describe('getLayoutItems', () => {
	it('collects items across all groups', () => {
		const s = schema({
			type: 'flat',
			groups: [group('g1', [input('a'), linebreak('lb')]), group('g2', [input('b')])]
		});
		expect(getLayoutItems(s).map((i) => (i.type === 'linebreak' ? i.id : i.paramId))).toEqual([
			'a',
			'lb',
			'b'
		]);
	});

	it('tolerates a group with no items', () => {
		const s = schema({ type: 'flat', groups: [{ id: 'g1', label: 'g1' }] });
		expect(getLayoutItems(s)).toEqual([]);
	});
});

describe('getInputItems', () => {
	it('keeps only input items, dropping outputs and linebreaks', () => {
		const s = schema({
			type: 'flat',
			groups: [group('g1', [input('a'), linebreak('lb'), { type: 'output', paramId: 'out' }])]
		});
		expect(getInputItems(s).map((i) => i.paramId)).toEqual(['a']);
	});

	it('preserves the source field so client-input filters work', () => {
		const s = schema({
			type: 'flat',
			groups: [group('g1', [input('a', { kind: 'client' }), input('b')])]
		});
		const clients = getInputItems(s).filter((i) => i.source?.kind === 'client');
		expect(clients.map((i) => i.paramId)).toEqual(['a']);
	});
});
