import { describe, expect, it } from 'vitest';
import {
	isItemUsedInLayout,
	addGroup,
	removeGroup,
	reorderGroups,
	handleGroupItemDrop,
	handleItemDrop,
	batchSetNumberWidgetType,
	removeItem,
	moveItemsToGroup,
	addTab,
	nextFreeLabel,
	isLabelTaken,
	moveGroupToTab,
	draftPlacements
} from '../operations';
import type { DiscoveredOutput, GroupConfig, UISchema } from '@selvajs/schemas';

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

describe('handleItemDrop — dynamicValueList output', () => {
	it('adds the output to schema.outputs[] (not just the layout)', () => {
		const s = tabbed([{ id: 't1', groups: [group('g1')] }]);
		const g = (s.layout as { tabs: { groups: GroupConfig[] }[] }).tabs[0].groups[0];
		const discovered: DiscoveredOutput = {
			id: 'bake-guid',
			nickname: 'DNY',
			type: 'dynamicValueList',
			description: '',
			targetInputId: 'target-input-guid'
		} as DiscoveredOutput;

		const result = handleItemDrop({
			schema: s,
			group: g,
			paramId: 'bake-guid',
			displayName: 'DNY',
			itemType: 'output',
			availableInputs: [],
			availableOutputs: [discovered],
			widgetType: 'dynamicValueList',
			outputType: 'dynamicValueList'
		});

		expect(result.added).toBe(true);
		// The bug: layout item added but schema.outputs[] left empty -> C# collector skips the bake.
		expect(s.outputs.map((o) => o.id)).toContain('bake-guid');
		const added = s.outputs.find((o) => o.id === 'bake-guid');
		expect(added?.type).toBe('dynamicValueList');
		expect((added as { targetInputId?: string }).targetInputId).toBe('target-input-guid');
	});
});

describe('tab names', () => {
	const labelled = (id: string, label: string) => ({ id, label, groups: [] });

	it('a new tab takes the first free number, never a name already in use', () => {
		const s = tabbed([labelled('t1', 'Tab 1'), labelled('t3', 'tab 3')]);
		const id = addTab(s);
		const tabs = (s.layout as { tabs: { id: string; label: string }[] }).tabs;
		expect(tabs.find((t) => t.id === id)?.label).toBe('Tab 2');
	});

	it('nextFreeLabel ignores case and surrounding spaces', () => {
		expect(nextFreeLabel([' group 1 ', 'Group 2'], 'Group')).toBe('Group 3');
	});

	it('a name is taken by another tab, ignoring case and spaces, but not by the tab itself', () => {
		const tabs = [labelled('t1', 'Test'), labelled('t2', 'Other')] as never;
		expect(isLabelTaken(tabs, ' TEST ', 't2')).toBe(true);
		expect(isLabelTaken(tabs, 'test', 't1')).toBe(false);
	});
});

describe('draftPlacements', () => {
	it('names each placed param by tab and group label, skipping line breaks', () => {
		const s = tabbed([
			{
				id: 't1',
				groups: [
					{ id: 'g1', label: 'Size', items: [item('i1', 'a'), { id: 'lb', type: 'linebreak' }] }
				]
			}
		]);
		(s.layout as { tabs: { label: string }[] }).tabs[0].label = 'General';
		expect(draftPlacements(s)).toEqual([{ paramId: 'a', tabLabel: 'General', groupLabel: 'Size' }]);
	});
});

describe('moveGroupToTab', () => {
	it('renames a group that lands beside one of the same name', () => {
		const sized = (id: string) => ({ id, label: 'Size', items: [], order: 0 });
		const s = tabbed([
			{ id: 't1', groups: [sized('g1')] },
			{ id: 't2', groups: [sized('g2')] }
		]);
		expect(moveGroupToTab(s, 't1', 'g1', 't2')).toBe(true);
		const tabs = (s.layout as { tabs: { groups: { label: string }[] }[] }).tabs;
		expect(tabs[1].groups.map((g) => g.label)).toEqual(['Size', 'Size 2']);
	});
});

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

describe('moveItemsToGroup', () => {
	const ids = (g: unknown) => (g as GroupConfig).items.map((i) => i.id);

	it('gathers selected items from several groups in layout order, after the anchor', () => {
		const a = group('a', [item('a1', 'p1'), item('a2', 'p2')]);
		const b = group('b', [item('b1', 'p3')]);
		const t = group('t', [item('t1', 'p4'), item('t2', 'p5')]);
		const s = tabbed([
			{ id: 'x', groups: [a] },
			{ id: 'y', groups: [b, t] }
		]);

		const moved = moveItemsToGroup(s, new Set(['a2', 'b1', 't1']), 't', 't1');

		expect(moved).toBe(2);
		expect(ids(t)).toEqual(['t1', 'a2', 'b1', 't2']);
		expect(ids(a)).toEqual(['a1']);
		expect(ids(b)).toEqual([]);
	});

	it('appends when there is no anchor', () => {
		const a = group('a', [item('a1', 'p1')]);
		const t = group('t', [item('t1', 'p2')]);
		moveItemsToGroup(flat([a, t]), new Set(['a1']), 't');
		expect(ids(t)).toEqual(['t1', 'a1']);
	});

	it('leaves an item whose parameter the target already holds', () => {
		const a = group('a', [item('a1', 'p1'), item('a2', 'p1')]);
		const t = group('t', [item('t1', 'p1')]);
		expect(moveItemsToGroup(flat([a, t]), new Set(['a1', 'a2']), 't')).toBe(0);
		expect(ids(a)).toEqual(['a1', 'a2']);
	});

	it('moves only one of two selected items that share a parameter', () => {
		const a = group('a', [item('a1', 'p1'), item('a2', 'p1')]);
		const t = group('t');
		expect(moveItemsToGroup(flat([a, t]), new Set(['a1', 'a2']), 't')).toBe(1);
		expect(ids(t)).toEqual(['a1']);
		expect(ids(a)).toEqual(['a2']);
	});
});
