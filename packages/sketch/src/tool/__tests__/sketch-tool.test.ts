import * as THREE from 'three';
import type { ThreeViewer, PointerTool } from '@selvajs/visualization/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Point3, SketchItem, SketchPolyline } from '../../model/curve.js';
import { createSketchTool, type DrawModeSpec, type SketchTool } from '../sketch-tool.js';

// A 200 px canvas under a camera looking straight down at a 200 m square, so a click at pixel
// (x, y) lands on scene point (x - 100, 100 - y, 0). With 0.001 m per unit, that is millimetres.

const MM = 0.001;
const SIZE = 200;

interface Harness {
	tool: SketchTool;
	pointer: PointerTool;
	changes: SketchItem[][];
	labels: { text: string; element: { style: Record<string, string> } }[];
	click(x: number, y: number, shiftKey?: boolean): boolean;
	move(x: number, y: number): void;
	key(key: string, modifiers?: { ctrlKey?: boolean; shiftKey?: boolean }): void;
	active(): string | null;
	sceneObjects(): number;
}

let keyListener: ((event: KeyboardEvent) => void) | null = null;

beforeEach(() => {
	keyListener = null;
	vi.stubGlobal('window', {
		addEventListener: (_: string, listener: (event: KeyboardEvent) => void) => {
			keyListener = listener;
		},
		removeEventListener: () => {
			keyListener = null;
		}
	});
	vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
		callback();
		return 0;
	});
	vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => vi.unstubAllGlobals());

function harness(maxItems?: number): Harness {
	const camera = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 1000);
	camera.position.set(0, 0, 100);
	camera.lookAt(0, 0, 0);
	camera.updateMatrixWorld();

	const canvas = {
		style: {} as Record<string, string>,
		getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE })
	};
	const scene = new THREE.Scene();
	const labels: Harness['labels'] = [];
	const tools = new Map<string, PointerTool>();
	let active: string | null = null;

	const viewer = {
		scene,
		renderer: { domElement: canvas },
		controls: { target: new THREE.Vector3() },
		cameraController: { getActiveCamera: () => camera },
		labelLayer: {
			addLabel: (text: string) => {
				const label = {
					text,
					element: { style: {} as Record<string, string>, addEventListener() {} }
				};
				labels.push(label);
				return {
					object: label,
					setText: (next: string) => {
						label.text = next;
					},
					setPosition() {},
					remove: () => {
						labels.splice(labels.indexOf(label), 1);
					}
				};
			}
		},
		tools: {
			register: ({ id, tool }: { id: string; tool: PointerTool }) => {
				tools.set(id, tool);
				return () => tools.delete(id);
			},
			setActive: (id: string | null) => {
				active = id;
				tools.forEach((tool, key) => tool.setEnabled?.(key === id));
			},
			getActive: () => active
		},
		addUserGeometry: (object: THREE.Object3D) => scene.add(object),
		removeUserGeometry: (object: THREE.Object3D) => object.removeFromParent(),
		invalidate() {}
	} as unknown as ThreeViewer;

	const changes: SketchItem[][] = [];
	const tool = createSketchTool({
		viewer,
		id: 'test',
		metersPerUnit: MM,
		unitSuffix: 'mm',
		maxItems,
		onChange: (curves) => changes.push(curves)
	});
	const pointer = tools.get('sketch:test')!;
	const event = (x: number, y: number, shiftKey = false) =>
		({ clientX: x, clientY: y, shiftKey }) as MouseEvent;

	return {
		tool,
		pointer,
		changes,
		labels,
		click: (x, y, shiftKey) => pointer.handleClick(event(x, y, shiftKey)),
		move: (x, y) => pointer.handleMove?.(event(x, y)),
		key: (key, modifiers = {}) =>
			keyListener?.({
				key,
				...modifiers,
				target: null,
				preventDefault() {},
				stopPropagation() {}
			} as unknown as KeyboardEvent),
		active: () => active,
		sceneObjects: () => scene.children.length
	};
}

const expectPoints = (actual: readonly Point3[], expected: Point3[]) => {
	expect(actual).toHaveLength(expected.length);
	actual.forEach((point, i) => {
		for (let axis = 0; axis < 3; axis++) expect(point[axis]).toBeCloseTo(expected[i][axis], 6);
	});
};

describe('createSketchTool', () => {
	it('adds nothing to the scene until there is a curve', () => {
		const h = harness();
		expect(h.sceneObjects()).toBe(0);
		h.tool.setItems([{ kind: 'line', from: [0, 0, 0], to: [1000, 0, 0] }]);
		expect(h.sceneObjects()).toBe(1);
		h.tool.setItems([]);
		expect(h.sceneObjects()).toBe(0);
	});

	it('lets clicks through while no mode is on', () => {
		const h = harness();
		expect(h.click(100, 100)).toBe(false);
		expect(h.changes).toEqual([]);
	});

	it('draws a line from two clicks, in model units', () => {
		const h = harness();
		h.tool.draw('line');
		expect(h.active()).toBe('sketch:test');
		expect(h.click(100, 100)).toBe(true);
		h.click(150, 100);
		const [line] = h.tool.getItems();
		expect(line.kind).toBe('line');
		expectPoints(
			[(line as { from: Point3 }).from, (line as { to: Point3 }).to],
			[
				[0, 0, 0],
				[50_000, 0, 0]
			]
		);
		expect(h.changes).toHaveLength(1);
		// The mode stays on for the next line.
		expect(h.tool.getState().mode).toBe('line');
	});

	it('replaces the curve of an input that takes one, and ends the mode', () => {
		const h = harness(1);
		h.tool.draw('line');
		h.click(100, 100);
		h.click(150, 100);
		expect(h.tool.getState().mode).toBeNull();
		expect(h.active()).toBeNull();

		h.tool.draw('line');
		h.click(100, 100);
		h.click(100, 50);
		const curves = h.tool.getItems();
		expect(curves).toHaveLength(1);
		expectPoints([(curves[0] as { to: Point3 }).to], [[0, 50_000, 0]]);
	});

	it('keeps drawing until the limit is reached', () => {
		const h = harness(2);
		h.tool.draw('line');
		h.click(100, 100);
		h.click(150, 100);
		expect(h.tool.getState().mode).toBe('line');
		h.click(100, 120);
		h.click(150, 120);
		expect(h.tool.getState().mode).toBeNull();
		expect(h.tool.getItems()).toHaveLength(2);
	});

	it('closes a polyline on a click back on its first point', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.click(150, 100);
		h.click(150, 50);
		// Within the snap band of the first point, not exactly on it.
		h.click(103, 98);
		const [curve] = h.tool.getItems() as SketchPolyline[];
		expect(curve.closed).toBe(true);
		expectPoints(curve.points, [
			[0, 0, 0],
			[50_000, 0, 0],
			[50_000, 50_000, 0]
		]);
	});

	it('ends an open polyline on a second click on the last point', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.click(150, 100);
		h.click(150, 100);
		const [curve] = h.tool.getItems() as SketchPolyline[];
		expect(curve.closed).toBe(false);
		expect(curve.points).toHaveLength(2);
	});

	it('places the next point at a typed length and angle', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.move(180, 60);
		for (const key of '2500<90') h.key(key);
		expect(h.tool.getState().typed).toBe('2500<90');
		h.key('Enter');
		h.key('Enter');
		const [curve] = h.tool.getItems() as SketchPolyline[];
		expectPoints(curve.points, [
			[0, 0, 0],
			[0, 2500, 0]
		]);
	});

	it('locks to 45 degrees with Shift', () => {
		const h = harness();
		h.tool.draw('line');
		h.click(100, 100);
		h.click(160, 97, true);
		const [line] = h.tool.getItems();
		expectPoints([(line as { to: Point3 }).to], [[60_000, 0, 0]]);
	});

	it('snaps to the grid', () => {
		const h = harness();
		h.tool.configure({ gridStep: 20_000 });
		h.tool.draw('line');
		h.click(101, 99);
		h.click(158, 103);
		const [line] = h.tool.getItems();
		expectPoints(
			[(line as { from: Point3 }).from, (line as { to: Point3 }).to],
			[
				[0, 0, 0],
				[60_000, 0, 0]
			]
		);
	});

	it('draws a control-point curve', () => {
		const h = harness();
		h.tool.draw('nurbs');
		h.click(20, 100);
		h.click(60, 40);
		h.click(120, 160);
		h.click(180, 100);
		h.tool.finish();
		const [curve] = h.tool.getItems();
		expect(curve).toMatchObject({ kind: 'nurbs', degree: 3 });
		expect(h.tool.getState().mode).toBeNull();
		expect(h.active()).toBeNull();
	});

	it('steps back with Backspace and out with Escape', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.click(150, 100);
		h.key('Backspace');
		expect(h.tool.getState().pendingPoints).toBe(1);
		h.key('Escape');
		expect(h.tool.getState()).toMatchObject({ mode: 'polyline', pendingPoints: 0 });
		h.key('Escape');
		expect(h.tool.getState().mode).toBeNull();
		expect(h.tool.getItems()).toEqual([]);
	});

	it('moves a vertex with two clicks and deletes one with Delete', () => {
		const h = harness();
		h.tool.setItems([
			{
				kind: 'polyline',
				closed: false,
				points: [
					[0, 0, 0],
					[50_000, 0, 0],
					[50_000, 50_000, 0]
				]
			}
		]);
		h.tool.move();
		h.click(150, 100);
		h.click(170, 120);
		expectPoints((h.tool.getItems()[0] as SketchPolyline).points, [
			[0, 0, 0],
			[70_000, -20_000, 0],
			[50_000, 50_000, 0]
		]);

		h.click(100, 100);
		h.key('Delete');
		expect((h.tool.getItems()[0] as SketchPolyline).points).toHaveLength(2);
		expect(h.changes).toHaveLength(2);
	});

	it('labels each straight segment with its length', () => {
		const h = harness();
		h.tool.setItems([{ kind: 'line', from: [0, 0, 0], to: [1250, 0, 0] }]);
		expect(h.labels.map((label) => label.text)).toEqual(['1250 mm']);
		h.tool.configure({ showDimensions: false });
		expect(h.labels).toEqual([]);
	});

	it('stops drawing when another tool takes the canvas', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.pointer.setEnabled?.(false);
		expect(h.tool.getState()).toMatchObject({ mode: null, pendingPoints: 0 });
		expect(h.click(120, 100)).toBe(false);
	});

	it('places a point per click', () => {
		const h = harness();
		h.tool.draw('point');
		h.click(100, 100);
		h.click(150, 50);
		expect(h.tool.getItems()).toMatchObject([{ kind: 'point', at: [0, 0, 0] }, { kind: 'point' }]);
		expectPoints([(h.tool.getItems()[1] as { at: Point3 }).at], [[50_000, 50_000, 0]]);
		expect(h.tool.getState().mode).toBe('point');
	});

	it('gives every item it makes an id and keeps it through edits', () => {
		const h = harness();
		h.tool.draw('line');
		h.click(100, 100);
		h.click(150, 100);
		h.tool.finish();
		const [{ id }] = h.tool.getItems();
		expect(id).toEqual(expect.any(String));

		h.tool.move();
		h.click(150, 100);
		h.click(170, 100);
		expect(h.tool.getItems()[0].id).toBe(id);
	});

	it('draws what a host mode builds, tags included', () => {
		// A rectangle from two corners, filed under its own Grasshopper branch.
		const rectangle: DrawModeSpec = {
			id: 'rectangle',
			pointCount: 2,
			build: (points) => {
				if (points.length < 2) return null;
				const [[x0, y0], [x1, y1]] = points;
				return [
					{
						kind: 'polyline',
						closed: true,
						points: [
							[x0, y0, 0],
							[x1, y0, 0],
							[x1, y1, 0],
							[x0, y1, 0]
						],
						path: [0, 1],
						attributes: { role: 'slab' }
					}
				];
			}
		};
		const h = harness();
		h.tool.draw(rectangle);
		expect(h.tool.getState().mode).toBe('rectangle');
		h.click(100, 100);
		h.click(150, 50);
		const [item] = h.tool.getItems() as SketchPolyline[];
		expect(item).toMatchObject({ closed: true, path: [0, 1], attributes: { role: 'slab' } });
		expectPoints(item.points, [
			[0, 0, 0],
			[50_000, 0, 0],
			[50_000, 50_000, 0],
			[0, 50_000, 0]
		]);
	});

	it('undoes and redoes, and reports both', () => {
		const h = harness();
		h.tool.draw('line');
		h.click(100, 100);
		h.click(150, 100);
		h.click(100, 120);
		h.click(150, 120);
		expect(h.tool.getState()).toMatchObject({ canUndo: true, canRedo: false });

		h.tool.undo();
		expect(h.tool.getItems()).toHaveLength(1);
		expect(h.tool.getState().canRedo).toBe(true);
		h.tool.undo();
		expect(h.tool.getItems()).toEqual([]);
		h.tool.redo();
		h.tool.redo();
		expect(h.tool.getItems()).toHaveLength(2);
		// Each step told the host, so the solve follows.
		expect(h.changes).toHaveLength(6);
	});

	it('undoes from the keyboard: a placed point first, then the last item', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.click(150, 100);
		h.key('Enter');
		h.click(100, 150);
		h.key('z', { ctrlKey: true });
		expect(h.tool.getState().pendingPoints).toBe(0);
		expect(h.tool.getItems()).toHaveLength(1);
		h.key('z', { ctrlKey: true });
		expect(h.tool.getItems()).toEqual([]);
		h.key('z', { ctrlKey: true, shiftKey: true });
		expect(h.tool.getItems()).toHaveLength(1);
	});

	it('forgets the history when the host replaces the items', () => {
		const h = harness();
		h.tool.draw('point');
		h.click(100, 100);
		h.tool.setItems([]);
		expect(h.tool.getState()).toMatchObject({ canUndo: false, canRedo: false });
	});

	it('removes everything it added on dispose', () => {
		const h = harness();
		h.tool.setItems([{ kind: 'line', from: [0, 0, 0], to: [1000, 0, 0] }]);
		h.tool.dispose();
		expect(h.labels).toEqual([]);
		expect(h.click(100, 100)).toBe(false);
	});
});
