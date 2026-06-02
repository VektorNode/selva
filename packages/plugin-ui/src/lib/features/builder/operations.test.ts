import { describe, expect, it } from 'vitest';
import {
	isItemUsedInLayout,
	addGroup,
	removeGroup,
	reorderGroups,
	handleGroupItemDrop,
	batchSetNumberWidgetType,
	removeItem
} from './operations';
import type { UISchema } from '@selvajs/schemas';

// operations.ts mutates the schema's layout in place. These pin the behaviour that's
// shared across both layout kinds (tabbed / flat) and the group-container resolution +
// write-back, which the refactor funnels through a single seam. tabId is '' in flat mode.

const item = (id: string, paramId: string, extra: Record<string, unknown> = {}) =>
	({ id, type: 'input', paramId, displayName: paramId, widgetType: 'number', ...extra }) as never;

const group = (id: string, items: unknown[] = []) => ({ id, label: id, items, order: 0 }) as never;

function tabbed(tabs: { id: string; groups: unknown[] }[]): UISchema {
	return { layout: { type: 'tabbed', tabs }, inputs: [], outputs: [] } as unknown as UISchema;
}
function flat(groups: unknown[]): UISchema {
	return { layout: { type: 'flat', groups }, inputs: [], outputs: [] } as unknown as UISchema;
}

describe('addGroup', () => {
	it('appends a group to the addressed tab (tabbed)', () => {
		const s = tabbed([{ id: 't1', groups: [group('g1')] }]);
		addGroup(s, 't1');
		const tabs = (s.layout as { tabs: { groups: unknown[] }[] }).tabs;
		expect(tabs[0].groups).toHaveLength(2);
	});

	it('appends a group to the layout (flat, tabId ignored)', () => {
		const s = flat([group('g1')]);
		addGroup(s, '');
		expect((s.layout as { groups: unknown[] }).groups).toHaveLength(2);
	});

	it('no-ops for an unknown tabId', () => {
		const s = tabbed([{ id: 't1', groups: [] }]);
		addGroup(s, 'missing');
		expect((s.layout as { tabs: { groups: unknown[] }[] }).tabs[0].groups).toHaveLength(0);
	});
});

describe('removeGroup', () => {
	it('drops the group by id (tabbed)', () => {
		const s = tabbed([{ id: 't1', groups: [group('g1'), group('g2')] }]);
		removeGroup(s, 't1', 'g1');
		const groups = (s.layout as { tabs: { groups: { id: string }[] }[] }).tabs[0].groups;
		expect(groups.map((g) => g.id)).toEqual(['g2']);
	});

	it('drops the group by id (flat)', () => {
		const s = flat([group('g1'), group('g2')]);
		removeGroup(s, '', 'g1');
		expect((s.layout as { groups: { id: string }[] }).groups.map((g) => g.id)).toEqual(['g2']);
	});
});

describe('reorderGroups', () => {
	it('moves a group and renumbers order (tabbed)', () => {
		const s = tabbed([{ id: 't1', groups: [group('a'), group('b'), group('c')] }]);
		reorderGroups(s, 't1', 0, 2);
		const groups = (s.layout as { tabs: { groups: { id: string; order: number }[] }[] }).tabs[0]
			.groups;
		expect(groups.map((g) => g.id)).toEqual(['b', 'c', 'a']);
		expect(groups.map((g) => g.order)).toEqual([0, 1, 2]);
	});

	it('moves a group (flat)', () => {
		const s = flat([group('a'), group('b')]);
		reorderGroups(s, '', 1, 0);
		expect((s.layout as { groups: { id: string }[] }).groups.map((g) => g.id)).toEqual(['b', 'a']);
	});
});

describe('isItemUsedInLayout', () => {
	it('finds an item across tabs/groups', () => {
		const s = tabbed([
			{ id: 't1', groups: [group('g1', [item('i1', 'p1')])] },
			{ id: 't2', groups: [group('g2', [item('i2', 'p2')])] }
		]);
		expect(isItemUsedInLayout(s, 'p2')).toBe(true);
		expect(isItemUsedInLayout(s, 'nope')).toBe(false);
	});

	it('returns false for a null schema', () => {
		expect(isItemUsedInLayout(null, 'p1')).toBe(false);
	});
});

describe('handleGroupItemDrop', () => {
	it('moves an item between groups (flat)', () => {
		const dragged = item('i1', 'p1');
		const s = flat([group('g1', [dragged]), group('g2', [])]);
		handleGroupItemDrop(s, 'g2', 'g2', 'g1', 'g1', dragged as never);
		const groups = (s.layout as { groups: { items: unknown[] }[] }).groups;
		expect(groups[0].items).toHaveLength(0);
		expect(groups[1].items).toHaveLength(1);
	});
});

describe('batchSetNumberWidgetType', () => {
	it('flips renderAsSlider on every number input', () => {
		const s = flat([
			group('g1', [item('i1', 'p1', { widgetType: 'number', config: { renderAsSlider: false } })]),
			group('g2', [item('i2', 'p2', { widgetType: 'number', config: { renderAsSlider: false } })])
		]);
		const { changed } = batchSetNumberWidgetType(s, true);
		expect(changed).toBe(2);
		const groups = (s.layout as { groups: { items: { config: { renderAsSlider: boolean } }[] }[] })
			.groups;
		expect(groups[0].items[0].config.renderAsSlider).toBe(true);
	});
});

describe('removeItem', () => {
	it('removes the item from its group and prunes the orphaned input', () => {
		const s = flat([group('g1', [item('i1', 'p1')])]);
		(s as { inputs: unknown[] }).inputs = [{ id: 'p1', nickname: 'p1', paramType: 'number' }];
		removeItem(s, '', 'g1', 'i1');
		expect((s.layout as { groups: { items: unknown[] }[] }).groups[0].items).toHaveLength(0);
		expect((s as { inputs: unknown[] }).inputs).toHaveLength(0);
	});
});
