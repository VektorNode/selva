import { describe, expect, it } from 'vitest';
import type { DiscoveredInput, DiscoveredOutput, UISchema } from '@selvajs/schemas';
import { buildSearchEntries, searchEntries } from '../builder-search';

const param = (id: string, nickname: string, description = '') =>
	({ id, nickname, description, type: 'number' }) as DiscoveredInput;

const schema = {
	inputs: [],
	outputs: [],
	layout: {
		type: 'tabbed',
		tabs: [
			{
				id: 't1',
				label: 'Facade',
				groups: [
					{
						id: 'g1',
						label: 'Panels',
						items: [
							{
								id: 'i1',
								type: 'input',
								paramId: 'p1',
								displayName: 'Width',
								widgetType: 'slider'
							},
							{ id: 'br', type: 'linebreak' }
						]
					}
				]
			}
		]
	}
} as unknown as UISchema;

const inputs = [param('p1', 'panel_w', 'Panel width in mm'), param('p2', 'panel_h')];
const outputs = [{ id: 'o1', nickname: 'Width total', type: 'number' }] as DiscoveredOutput[];
const entries = buildSearchEntries(schema, inputs, outputs);
const find = (query: string) => searchEntries(entries, query);

describe('buildSearchEntries', () => {
	it('points a placed parameter at its card and an unplaced one at the sidebar', () => {
		expect(entries.find((e) => e.key === 'item:i1')).toMatchObject({
			label: 'Width',
			detail: 'Facade › Panels',
			target: { kind: 'item', tabId: 't1', groupId: 'g1', itemId: 'i1' }
		});
		expect(entries.find((e) => e.key === 'param:p2')).toMatchObject({
			detail: 'Not placed',
			target: { kind: 'param', nickname: 'panel_h' }
		});
	});

	it('lists a placed parameter once and skips line breaks', () => {
		expect(entries.filter((e) => e.key.endsWith('p1') || e.key.endsWith('i1'))).toHaveLength(1);
		expect(entries.some((e) => e.key.includes('br'))).toBe(false);
	});
});

const tabTarget = { kind: 'tab', tabId: 't' } as const;

describe('searchEntries', () => {
	it('finds nothing for a blank query', () => {
		expect(find('   ')).toEqual([]);
	});

	it('finds a renamed card by its Grasshopper nickname', () => {
		expect(find('panel_w').map((e) => e.key)).toEqual(['item:i1']);
	});

	it('finds a parameter by the group it sits in, across word order', () => {
		expect(find('panels width').map((e) => e.key)).toContain('item:i1');
	});

	it('finds settings by label and by hidden terms', () => {
		expect(find('background')[0].target).toMatchObject({
			panel: 'app',
			controlId: 'viewer-background'
		});
		expect(find('export')[0].label).toBe('Schema file');
	});

	it('ranks a label prefix above a match in the middle of a label', () => {
		const ranked = searchEntries(
			[
				{ key: 'a', kind: 'tab', label: 'Base width', detail: '', terms: '', target: tabTarget },
				{ key: 'b', kind: 'tab', label: 'Width', detail: '', terms: '', target: tabTarget }
			],
			'width'
		);
		expect(ranked.map((e) => e.key)).toEqual(['b', 'a']);
	});
});
