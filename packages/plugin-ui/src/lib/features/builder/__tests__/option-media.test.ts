import { describe, expect, it } from 'vitest';
import type { UISchema } from '@selvajs/schemas';
import { assetId, iconNodeToPath, listIcons, putAsset } from '../option-assets';
import { assetBytes, pruneUnusedMedia } from '../option-media';

describe('iconNodeToPath', () => {
	it('keeps path data as it is', () => {
		expect(iconNodeToPath([['path', { d: 'M15 21v-8' }]])).toBe('M15 21v-8');
		// After an absolute M the extra pairs are absolute line-tos already.
		expect(iconNodeToPath([['path', { d: 'M2 2 5 5' }]])).toBe('M2 2 5 5');
	});

	// Lucide's own paths open with a relative `m`. Joined into one path, a later `m` would be read
	// relative to where the previous shape ended, so each one is made absolute.
	it('keeps every path where Lucide draws it once they are joined', () => {
		expect(
			iconNodeToPath([
				['path', { d: 'm16 18 6-6-6-6' }],
				['path', { d: 'm8 6-6 6 6 6' }]
			])
		).toBe('M16 18l6-6-6-6 M8 6l-6 6 6 6');
	});

	it('leaves a relative start alone when a command follows it', () => {
		expect(iconNodeToPath([['path', { d: 'm2 3h4' }]])).toBe('M2 3h4');
	});

	it('draws a circle as two arcs', () => {
		expect(iconNodeToPath([['circle', { cx: '12', cy: '12', r: '10' }]])).toBe(
			'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0'
		);
	});

	it('draws an ellipse with both radii', () => {
		expect(iconNodeToPath([['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }]])).toBe(
			'M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0'
		);
	});

	it('draws a square-cornered rect', () => {
		expect(iconNodeToPath([['rect', { x: '3', y: '3', width: '18', height: '18' }]])).toBe(
			'M3 3h18v18h-18z'
		);
	});

	it('draws a rounded rect with quarter arcs', () => {
		expect(iconNodeToPath([['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2' }]])).toBe(
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z'
		);
	});

	it('draws lines, polylines and closed polygons', () => {
		expect(iconNodeToPath([['line', { x1: '4', y1: '4', x2: '20', y2: '20' }]])).toBe('M4 4L20 20');
		expect(iconNodeToPath([['polyline', { points: '22 12 18 12 15 21' }]])).toBe(
			'M22 12L18 12L15 21'
		);
		expect(iconNodeToPath([['polygon', { points: '3 11,22 2,13 21' }]])).toBe('M3 11L22 2L13 21z');
	});

	it('joins every shape of an icon into one path', () => {
		expect(
			iconNodeToPath([
				['path', { d: 'M3 3h18' }],
				['line', { x1: '4', y1: '4', x2: '20', y2: '20' }]
			])
		).toBe('M3 3h18 M4 4L20 20');
	});
});

describe('assetId', () => {
	it('is FNV-1a over the content, cut to 12 hex digits', () => {
		// FNV-1a 64 of "a" is af63dc4c8601ec8c.
		expect(assetId({ d: 'a' })).toBe('af63dc4c8601');
	});

	it('tells different content apart', () => {
		expect(assetId({ d: 'M3 3h18' })).not.toBe(assetId({ d: 'M3 3h17' }));
	});
});

const PARAM_DROPDOWN = '11111111-1111-4111-8111-111111111111';
const PARAM_DYNAMIC = '22222222-2222-4222-8222-222222222222';

function schemaWithMedia(): UISchema {
	return {
		layout: {
			type: 'flat',
			groups: [
				{
					id: 'g',
					label: 'Material',
					items: [
						{
							id: 'a',
							type: 'input',
							widgetType: 'dropdown',
							paramId: PARAM_DROPDOWN,
							config: {
								options: { Oak: '0', Larch: '1' },
								optionMedia: { Oak: { icon: 'i1' }, Pine: { icon: 'i2' } }
							}
						},
						{
							id: 'b',
							type: 'input',
							widgetType: 'dynamicValueList',
							paramId: PARAM_DYNAMIC,
							config: { optionMedia: { 'Zone 20': { image: 'i4' } } }
						}
					]
				}
			]
		},
		assets: {
			i1: { d: 'M1 1' },
			i2: { d: 'M2 2' },
			i3: { d: 'M3 3' },
			i4: { img: 'data:image/png;base64,AA==' }
		},
		inputs: [],
		outputs: []
	} as unknown as UISchema;
}

describe('putAsset', () => {
	it('stores identical content once', () => {
		const schema = { layout: { type: 'flat', groups: [] } } as unknown as UISchema;

		const first = putAsset(schema, { d: 'M3 3h18' });
		const second = putAsset(schema, { d: 'M3 3h18' });

		expect(second).toBe(first);
		expect(Object.keys(schema.assets ?? {})).toEqual([first]);
	});
});

describe('pruneUnusedMedia', () => {
	it('drops media for options Grasshopper no longer has, and assets nothing points at', () => {
		const schema = schemaWithMedia();

		pruneUnusedMedia(schema);

		const [dropdown, dynamic] = (
			schema.layout as unknown as { groups: { items: { config: unknown }[] }[] }
		).groups[0].items;
		expect((dropdown.config as { optionMedia: object }).optionMedia).toEqual({
			Oak: { icon: 'i1' }
		});
		// A dynamic list's options exist only at runtime, so its media is kept as authored.
		expect((dynamic.config as { optionMedia: object }).optionMedia).toEqual({
			'Zone 20': { image: 'i4' }
		});
		expect(Object.keys(schema.assets ?? {}).sort()).toEqual(['i1', 'i4']);
	});

	it('removes the assets table once it is empty', () => {
		const schema = schemaWithMedia();
		const items = (
			schema.layout as unknown as { groups: { items: { config: Record<string, unknown> }[] }[] }
		).groups[0].items;
		for (const item of items) delete item.config.optionMedia;

		pruneUnusedMedia(schema);

		expect(schema.assets).toBeUndefined();
	});
});

describe('assetBytes', () => {
	it('counts the characters the assets add to the saved schema', () => {
		expect(assetBytes(schemaWithMedia().assets)).toBe(
			'M1 1'.length + 'M2 2'.length + 'M3 3'.length + 'data:image/png;base64,AA=='.length
		);
	});
});

describe('listIcons', () => {
	it('names icons the way Lucide does, once each, even when an alias collides', () => {
		const square = [['rect', { x: '3', y: '3', width: '18', height: '18' }]];
		const arrow = [['path', { d: 'M3 3h18' }]];

		const list = listIcons({ ArrowDownAZ: arrow, ArrowDownAz: arrow, Square: square });

		expect(list.map((icon) => icon.name)).toEqual(['arrow-down-az', 'square']);
	});
});
