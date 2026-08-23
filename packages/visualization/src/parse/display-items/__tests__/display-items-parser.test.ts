import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { describe, expect, it } from 'vitest';

import { parseDisplayItems } from '../display-items-parser';

import type { DisplayItem } from '../types';

describe('parseDisplayItems', () => {
	it('returns empty for undefined or empty items', () => {
		expect(parseDisplayItems(undefined)).toEqual([]);
		expect(parseDisplayItems([])).toEqual([]);
	});

	it('builds a THREE.Points from a point item in the scene frame (Rhino Z-up, no rotation)', () => {
		const items: DisplayItem[] = [
			{ kind: 'point', id: 'c:0', name: 'P0', layer: '', position: { X: 1, Y: 2, Z: 3 } }
		];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);

		const points = objs[0] as THREE.Points;
		expect(points).toBeInstanceOf(THREE.Points);
		expect(points.name).toBe('P0');
		expect(points.userData.id).toBe('c:0');

		const pos = points.geometry.getAttribute('position');
		expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1, 2, 3]);
	});

	it('lands at Rhino coordinates unrotated', () => {
		const items: DisplayItem[] = [
			{ kind: 'point', id: 'c:0', name: 'P', layer: '', position: { X: 1, Y: 2, Z: 3 } }
		];

		const points = parseDisplayItems(items)[0] as THREE.Points;
		const pos = points.geometry.getAttribute('position');
		expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([1, 2, 3]);
	});

	it('honors color and opacity on the point material', () => {
		const items: DisplayItem[] = [
			{
				kind: 'point',
				id: 'c:0',
				name: 'P',
				layer: '',
				color: '#ff0000',
				opacity: 0.5,
				position: { X: 0, Y: 0, Z: 0 }
			}
		];

		const points = parseDisplayItems(items)[0] as THREE.Points;
		const mat = points.material as THREE.PointsMaterial;
		expect(mat.opacity).toBe(0.5);
		expect(mat.transparent).toBe(true);
		expect(mat.color.getHexString()).toBe('ff0000');
	});

	it('builds a curve from backend-tessellated points', () => {
		const items: DisplayItem[] = [
			{
				kind: 'curve',
				id: 'c:0',
				name: 'edge',
				layer: 'L',
				points: [0, 0, 0, 1, 2, 3, 4, 5, 6],
				width: 5,
				color: '#00ff00'
			}
		];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);

		const line = objs[0] as Line2;
		expect(line).toBeInstanceOf(Line2);
		expect(line.name).toBe('edge');
		expect(line.userData).toMatchObject({ id: 'c:0', layer: 'L', kind: 'curve' });

		// Line2 stores an instanced start/end pair per segment; 3 vertices → 2 segments.
		expect(line.geometry.getAttribute('instanceStart').count).toBe(2);

		const mat = line.material as Line2['material'] & { linewidth: number };
		expect(mat.linewidth).toBe(5);
		expect(mat.color.getHexString()).toBe('00ff00');
	});

	it('skips a curve with fewer than two points', () => {
		const items: DisplayItem[] = [
			{ kind: 'curve', id: 'c:0', name: 'degenerate', layer: '', points: [1, 2, 3] },
			{ kind: 'point', id: 'c:1', name: 'P', layer: '', position: { X: 0, Y: 0, Z: 0 } }
		];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);
		expect(objs[0]).toBeInstanceOf(THREE.Points);
	});

	it('throws on a curve with no tessellated points', () => {
		// A Display component predating backend tessellation sends legacy Rhino JSON and no `points`.
		// Skipping would render a scene silently missing geometry, with no hint that the definition
		// needs its Display component upgraded.
		const items = [
			{ kind: 'curve', id: 'c:0', name: 'edge', layer: '', json: '{}' }
		] as unknown as DisplayItem[];

		expect(() => parseDisplayItems(items)).toThrowError(/outdated Display component/);
	});

	it('names the offending item so the definition can be traced', () => {
		const items = [
			{ kind: 'curve', id: 'batch7:3', name: 'edge', layer: '', json: '{}' }
		] as unknown as DisplayItem[];

		expect(() => parseDisplayItems(items)).toThrowError(/batch7:3/);
	});

	it('aborts the batch rather than rendering the items around a stale curve', () => {
		const items = [
			{ kind: 'point', id: 'c:0', name: 'P', layer: '', position: { X: 0, Y: 0, Z: 0 } },
			{ kind: 'curve', id: 'c:1', name: 'stale', layer: '' }
		] as unknown as DisplayItem[];

		expect(() => parseDisplayItems(items)).toThrow();
	});

	it('builds a fat Line2 from a curve, honoring width, color, and userData', () => {
		const items: DisplayItem[] = [
			{
				kind: 'curve',
				id: 'c:0',
				name: 'edge',
				layer: 'L',
				points: [0, 0, 0, 1, 0, 0],
				width: 5,
				color: '#00ff00'
			}
		];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);

		const line = objs[0] as Line2;
		expect(line).toBeInstanceOf(Line2);
		expect(line.name).toBe('edge');
		expect(line.userData).toMatchObject({ id: 'c:0', layer: 'L', kind: 'curve' });

		const mat = line.material as Line2['material'] & { linewidth: number };
		expect(mat.linewidth).toBe(5);
		expect(mat.color.getHexString()).toBe('00ff00');
	});

	it('falls back to the default line width when a curve omits width', () => {
		const items: DisplayItem[] = [
			{ kind: 'curve', id: 'c:0', name: 'e', layer: '', points: [0, 0, 0, 1, 0, 0] }
		];

		const line = parseDisplayItems(items)[0] as Line2;
		const mat = line.material as Line2['material'] & { linewidth: number };
		expect(mat.linewidth).toBe(2);
	});

	it('skips unknown kinds without throwing', () => {
		const items = [
			{ kind: 'label', id: 'c:0', name: 'L', layer: '' },
			{ kind: 'point', id: 'c:1', name: 'P', layer: '', position: { X: 0, Y: 0, Z: 0 } }
		] as unknown as DisplayItem[];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);
		expect(objs[0]).toBeInstanceOf(THREE.Points);
	});

	it('narrows the DisplayItem union exhaustively (compile-time never guard)', () => {
		// Mirrors the parser's default-case guard: if a new kind is added to the DisplayItem union
		// and this switch (or the parser's) doesn't handle it, the `never` assignment below becomes
		// a compile error — the guarantee documented in types.ts.
		const label = (item: DisplayItem): string => {
			switch (item.kind) {
				case 'curve':
					return `curve:${item.name}`;
				case 'point':
					return `point:${item.name}`;
				default: {
					const unhandled: never = item;
					return String(unhandled);
				}
			}
		};

		expect(
			label({ kind: 'point', id: 'c:0', name: 'P', layer: '', position: { X: 0, Y: 0, Z: 0 } })
		).toBe('point:P');
		expect(label({ kind: 'curve', id: 'c:1', name: 'E', layer: '', points: [] })).toBe('curve:E');
	});

	it('skips a degenerate curve without aborting the rest of the batch', () => {
		const items: DisplayItem[] = [
			{ kind: 'curve', id: 'c:0', name: 'degenerate', layer: '', points: [1, 2, 3] },
			{ kind: 'point', id: 'c:1', name: 'P', layer: '', position: { X: 0, Y: 0, Z: 0 } },
			{ kind: 'curve', id: 'c:2', name: 'good', layer: '', points: [0, 0, 0, 1, 0, 0] }
		];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(2);
		expect(objs[0]).toBeInstanceOf(THREE.Points);
		expect(objs[1]).toBeInstanceOf(Line2);
		expect(objs[1].name).toBe('good');
	});

	it('skips points with missing or non-finite positions instead of throwing or emitting NaN', () => {
		const items = [
			{ kind: 'point', id: 'c:0', name: 'no-position', layer: '' },
			{ kind: 'point', id: 'c:1', name: 'partial', layer: '', position: { X: 1, Y: 2 } },
			{ kind: 'point', id: 'c:2', name: 'nan', layer: '', position: { X: NaN, Y: 0, Z: 0 } },
			{
				kind: 'point',
				id: 'c:3',
				name: 'infinite',
				layer: '',
				position: { X: 0, Y: Infinity, Z: 0 }
			},
			{
				kind: 'point',
				id: 'c:4',
				name: 'string-coord',
				layer: '',
				position: { X: '1', Y: 2, Z: 3 }
			},
			{ kind: 'point', id: 'c:5', name: 'valid', layer: '', position: { X: 4, Y: 5, Z: 6 } }
		] as unknown as DisplayItem[];

		const objs = parseDisplayItems(items);
		expect(objs).toHaveLength(1);

		const points = objs[0] as THREE.Points;
		expect(points.name).toBe('valid');
		const pos = points.geometry.getAttribute('position');
		expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([4, 5, 6]);
	});
});
