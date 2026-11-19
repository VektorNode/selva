import { describe, expect, it } from 'vitest';
import type { DocumentInventory } from '../generated/index.js';
import {
	countLineChanges,
	diffInventories,
	diffLines,
	inventoryDiffToMarkdown,
	inventoryWarnings,
	inventoryWarningText,
	summarizeInventory
} from '../inventory.js';

const CORE = '00000000-0000-0000-0000-000000000000';
const SELVA = '69ef43c6-0bc8-4b49-8e4d-a27f732cc10b';
const CHARTS = '2e872be7-90c2-496a-b80c-f2623c249347';

function inventory(patch: Partial<DocumentInventory> = {}): DocumentInventory {
	return {
		extractedWith: '0.26.0.0',
		libraries: [
			{
				id: CORE,
				name: 'Grasshopper',
				author: 'McNeel',
				version: '9.0',
				core: true,
				serverVersion: '9.0'
			},
			{
				id: SELVA,
				name: 'Selva',
				author: 'VN',
				version: '0.25.0.0',
				core: false,
				serverVersion: '0.25.0.0'
			}
		],
		components: [
			{ id: 'c1', type: 't-loft', name: 'Loft', obsolete: false },
			{ id: 'c2', type: 't-move', name: 'Move', obsolete: false }
		],
		values: [
			{ id: 's1', kind: 'slider', label: 'Gap', text: '0.01', sha256: 'h1', min: 0, max: 1 },
			{ id: 'f1', kind: 'slider', label: 'Width', text: '10', sha256: 'w1', min: 0, max: 20 }
		],
		scripts: [
			{
				id: 'sc1',
				label: 'Panels',
				language: 'csharp',
				sha256: 'a',
				lineCount: 3,
				lineHashes: ['l1', 'l2', 'l3'],
				secrets: []
			}
		],
		wires: { count: 4, sha256: 'w' },
		...patch
	};
}

describe('inventoryWarnings', () => {
	it('names missing plugins, other versions, obsolete components and secrets', () => {
		const inv = inventory({
			libraries: [
				...inventory().libraries.slice(0, 1),
				{
					id: SELVA,
					name: 'Selva',
					author: 'VN',
					version: '0.25.0.0',
					core: false,
					serverVersion: '0.26.0.0'
				},
				{ id: CHARTS, name: 'Charts', author: 'VN', version: '1.3.0.0', core: false }
			],
			components: [
				{ id: 'o1', type: 't', name: 'Web Display', library: SELVA, obsolete: true },
				{ id: 'o2', type: 't', name: 'Web Display', library: SELVA, obsolete: true }
			],
			scripts: [{ ...inventory().scripts[0], secrets: ['github-token'] }]
		});
		expect(inventoryWarnings(inv)).toEqual([
			{ kind: 'missingPlugin', plugin: 'Charts', version: '1.3.0.0' },
			{ kind: 'pluginVersion', plugin: 'Selva', version: '0.25.0.0', serverVersion: '0.26.0.0' },
			{ kind: 'obsolete', component: 'Web Display', plugin: 'Selva', count: 2 },
			{ kind: 'secret', in: 'script', label: 'Panels', rules: ['github-token'] }
		]);
		expect(summarizeInventory(inv)).toEqual({
			missingPlugins: ['Charts'],
			unloadedComponents: [],
			obsoleteComponents: 2
		});
	});

	it('names components an older plugin release lacks, but not those of a missing plugin', () => {
		const inv = inventory({
			libraries: [
				...inventory().libraries.slice(0, 1),
				{
					id: SELVA,
					name: 'Selva',
					author: 'VN',
					version: '0.27.0.0',
					core: false,
					serverVersion: '0.25.0.0'
				},
				{ id: CHARTS, name: 'Charts', author: 'VN', version: '1.3.0.0', core: false }
			],
			unloaded: [
				{ id: 'u1', type: 't-repeat', name: 'Repeat', library: SELVA },
				{ id: 'u2', type: 't-repeat', name: 'Repeat', library: SELVA },
				{ id: 'u3', type: 't-bar', name: 'Bar Chart', library: CHARTS }
			]
		});
		const unloaded = inventoryWarnings(inv).filter((w) => w.kind === 'unloaded');
		expect(unloaded).toEqual([
			{
				kind: 'unloaded',
				component: 'Repeat',
				plugin: 'Selva',
				version: '0.27.0.0',
				serverVersion: '0.25.0.0',
				count: 2
			}
		]);
		expect(summarizeInventory(inv).unloadedComponents).toEqual(['Repeat']);
		expect(inventoryWarningText(unloaded[0])).toContain(
			'saved with Selva 0.27.0.0; the server runs 0.25.0.0, which lacks it'
		);
	});

	it('lists an unloaded component before a version note', () => {
		const inv = inventory({
			libraries: [
				{
					id: SELVA,
					name: 'Selva',
					author: 'VN',
					version: '0.27.0.0',
					core: false,
					serverVersion: '0.25.0.0'
				}
			],
			unloaded: [{ id: 'u1', type: 't-repeat', name: 'Repeat', library: SELVA }]
		});
		expect(inventoryWarnings(inv).map((w) => w.kind)).toEqual(['unloaded', 'pluginVersion']);
	});

	it('warns about, but does not count, a component no named plugin provides', () => {
		const inv = inventory({
			unloaded: [
				{ id: 'u1', type: 't-py', name: 'GhPython Script', library: 'unnamed-core-assembly' },
				{ id: 'u2', type: 't-x', name: 'Mystery' }
			]
		});
		expect(inventoryWarnings(inv).filter((w) => w.kind === 'unloaded')).toHaveLength(2);
		expect(summarizeInventory(inv).unloadedComponents).toEqual([]);
	});

	it('has nothing to say about a clean file', () => {
		expect(inventoryWarnings(inventory())).toEqual([]);
	});
});

describe('diffInventories', () => {
	it('finds nothing between identical files', () => {
		const d = diffInventories(inventory(), inventory());
		expect(d.identical).toBe(true);
		expect(inventoryDiffToMarkdown(d)).toBe('');
	});

	it('counts components added and removed by type', () => {
		const d = diffInventories(
			inventory(),
			inventory({
				components: [
					{ id: 'c1', type: 't-loft', name: 'Loft', obsolete: false },
					{ id: 'c3', type: 't-loft', name: 'Loft', obsolete: false },
					{ id: 'c4', type: 't-loft', name: 'Loft', obsolete: false }
				]
			})
		);
		expect(d.components).toEqual({
			added: [{ name: 'Loft', count: 2 }],
			removed: [{ name: 'Move', count: 1 }]
		});
	});

	it('reports internal values but leaves form inputs to the form diff', () => {
		const after = inventory({
			values: [
				{ id: 's1', kind: 'slider', label: 'Gap', text: '0.1', sha256: 'h2', min: 0, max: 2 },
				{ id: 'f1', kind: 'slider', label: 'Width', text: '12', sha256: 'w2', min: 0, max: 20 }
			]
		});
		const d = diffInventories(inventory(), after, { formIds: ['F1'] });
		expect(d.values).toEqual([
			{
				id: 's1',
				label: 'Gap',
				kind: 'slider',
				before: '0.01',
				after: '0.1',
				range: { before: '0–1', after: '0–2' }
			}
		]);
	});

	it('hides a value that looks like a secret', () => {
		const after = inventory({
			values: [{ id: 's1', kind: 'panel', label: 'Key', text: '', sha256: 'x', secrets: ['jwt'] }]
		});
		const d = diffInventories(inventory(), after);
		expect(d.values[0]).toMatchObject({ before: '0.01', after: null });
		expect(inventoryDiffToMarkdown(d)).toContain('(hidden)');
	});

	it('counts script lines and plugin versions', () => {
		const after = inventory({
			libraries: [
				inventory().libraries[0],
				{ ...inventory().libraries[1], version: '0.26.0.0' },
				{ id: CHARTS, name: 'Charts', author: 'VN', version: '1.3.0.0', core: false }
			],
			scripts: [
				{ ...inventory().scripts[0], sha256: 'b', lineCount: 4, lineHashes: ['l1', 'x', 'l3', 'y'] }
			]
		});
		const d = diffInventories(inventory(), after);
		expect(d.scripts).toEqual([
			{
				id: 'sc1',
				label: 'Panels',
				language: 'csharp',
				change: 'changed',
				linesAdded: 2,
				linesRemoved: 1
			}
		]);
		expect(d.plugins).toEqual([
			{ plugin: 'Selva', change: 'changed', before: '0.25.0.0', after: '0.26.0.0' },
			{ plugin: 'Charts', change: 'added', after: '1.3.0.0' }
		]);
		const md = inventoryDiffToMarkdown(d);
		expect(md).toContain('Script **Panels** edited (+2 −1 lines)');
		expect(md).toContain('Uses Charts 1.3.0.0');
	});

	it('sees a rewiring that adds and removes nothing', () => {
		const d = diffInventories(inventory(), inventory({ wires: { count: 4, sha256: 'other' } }));
		expect(d.identical).toBe(false);
		expect(inventoryDiffToMarkdown(d)).toBe('- Wiring changed');
	});
});

describe('line diff', () => {
	it('counts by longest common subsequence', () => {
		expect(countLineChanges(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'e'])).toEqual({
			added: 1,
			removed: 1
		});
		expect(countLineChanges([], ['a'])).toEqual({ added: 1, removed: 0 });
	});

	it('shows a text diff in order', () => {
		expect(diffLines('a\nb\nc\n', 'a\nB\nc')).toEqual([
			{ op: 'same', text: 'a' },
			{ op: 'remove', text: 'b' },
			{ op: 'add', text: 'B' },
			{ op: 'same', text: 'c' }
		]);
	});

	it('stays fast on very long scripts', () => {
		const a = Array.from({ length: 5000 }, (_, i) => `a${i}`);
		const b = Array.from({ length: 5000 }, (_, i) => `b${i}`);
		expect(countLineChanges(a, b)).toEqual({ added: 5000, removed: 5000 });
	});
});
