import { describe, expect, it } from 'vitest';
import { remapImportedSchema } from '../schema-remap';
import type { DiscoveredInput, DiscoveredOutput, UISchema } from '@selvajs/schemas';

// Imported .sls schemas carry parameter ids from the document they were exported from.
// GH InstanceGuids are minted per document instance, so on save the plugin purges every
// id that doesn't resolve on the live canvas. remapImportedSchema rebinds those ids onto
// the live params by nickname before save, so the import survives reconciliation.

const liveInput = (id: string, nickname: string): DiscoveredInput =>
	({ id, name: nickname, nickname, description: '', type: 'number' }) as DiscoveredInput;

const liveOutput = (id: string, nickname: string): DiscoveredOutput =>
	({ id, nickname, type: 'text' }) as DiscoveredOutput;

function importedSchema(): UISchema {
	return {
		id: 's1',
		name: 'New Schema',
		inputs: [
			{ id: 'old-a', nickname: 'Dicke', paramType: 'number' },
			{ id: 'old-b', nickname: 'Prefix', paramType: 'text' }
		],
		outputs: [{ id: 'old-out', nickname: 'Result', type: 'text' }],
		layout: {
			type: 'flat',
			groups: [
				{
					id: 'g1',
					label: 'Allgemeines',
					items: [
						{ id: 'li-a', type: 'input', widgetType: 'number', paramId: 'old-a' },
						{
							id: 'li-b',
							type: 'input',
							widgetType: 'text',
							paramId: 'old-b',
							visibilityCondition: {
								rules: [{ paramId: 'old-a', operator: 'equals', value: 1 }]
							}
						},
						{ id: 'lb-1', type: 'linebreak' }
					],
					visibilityCondition: {
						rules: [{ paramId: 'old-a', operator: 'isNotEmpty' }]
					}
				}
			]
		}
	} as unknown as UISchema;
}

describe('remapImportedSchema', () => {
	it('rebinds input/output ids onto live params sharing the nickname', () => {
		const result = remapImportedSchema(
			importedSchema(),
			[liveInput('live-a', 'Dicke'), liveInput('live-b', 'Prefix')],
			[liveOutput('live-out', 'Result')]
		);

		expect(result.schema.inputs.map((i) => i.id)).toEqual(['live-a', 'live-b']);
		expect(result.schema.outputs.map((o) => o.id)).toEqual(['live-out']);
		expect(result.remappedCount).toBe(3);
		expect(result.unmatched).toEqual([]);
	});

	it('rewrites layout item, item-condition, and group-condition paramIds through the id map', () => {
		const result = remapImportedSchema(
			importedSchema(),
			[liveInput('live-a', 'Dicke'), liveInput('live-b', 'Prefix')],
			[liveOutput('live-out', 'Result')]
		);

		const groups = (result.schema.layout as { groups: any[] }).groups;
		const items = groups[0].items;
		expect(items[0].paramId).toBe('live-a');
		expect(items[1].paramId).toBe('live-b');
		expect(items[1].visibilityCondition.rules[0].paramId).toBe('live-a');
		expect(groups[0].visibilityCondition.rules[0].paramId).toBe('live-a');
		// Line break is left untouched.
		expect(items[2].type).toBe('linebreak');
	});

	it('reports nicknames with no live counterpart and leaves their ids untouched', () => {
		const result = remapImportedSchema(
			importedSchema(),
			[liveInput('live-a', 'Dicke')], // Prefix is missing on the live canvas
			[]
		);

		expect(result.unmatched).toEqual(['Prefix', 'Result']);
		expect(result.schema.inputs.find((i) => i.nickname === 'Prefix')?.id).toBe('old-b');
		// Matched ones still rebind.
		expect(result.schema.inputs.find((i) => i.nickname === 'Dicke')?.id).toBe('live-a');
		expect(result.remappedCount).toBe(1);
	});
});
