import * as THREE from 'three';
import type { ThreeViewer, PointerTool } from '@selvajs/visualization/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Point3, SketchCurve, SketchPolyline } from '../../model/curve.js';
import { createSketchTool, type SketchTool } from '../sketch-tool.js';

// A 200 px canvas under a camera looking straight down at a 200 m square, so a click at pixel
// (x, y) lands on scene point (x - 100, 100 - y, 0). With 0.001 m per unit, that is millimetres.

const MM = 0.001;
const SIZE = 200;

interface Harness {
	tool: SketchTool;
	pointer: PointerTool;
	changes: SketchCurve[][];
	labels: { text: string; element: { style: Record<string, string> } }[];
	click(x: number, y: number, shiftKey?: boolean): boolean;
	move(x: number, y: number): void;
	key(key: string): void;
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

function harness(maxCurves?: number): Harness {
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

	const changes: SketchCurve[][] = [];
	const tool = createSketchTool({
		viewer,
		id: 'test',
		metersPerUnit: MM,
		unitSuffix: 'mm',
		maxCurves,
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
		key: (key) =>
			keyListener?.({
				key,
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
		h.tool.setCurves([{ kind: 'line', from: [0, 0, 0], to: [1000, 0, 0] }]);
		expect(h.sceneObjects()).toBe(1);
		h.tool.setCurves([]);
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
		const [line] = h.tool.getCurves();
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
		const curves = h.tool.getCurves();
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
		expect(h.tool.getCurves()).toHaveLength(2);
	});

	it('closes a polyline on a click back on its first point', () => {
		const h = harness();
		h.tool.draw('polyline');
		h.click(100, 100);
		h.click(150, 100);
		h.click(150, 50);
		// Within the snap band of the first point, not exactly on it.
		h.click(103, 98);
		const [curve] = h.tool.getCurves() as SketchPolyline[];
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
		const [curve] = h.tool.getCurves() as SketchPolyline[];
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
		const [curve] = h.tool.getCurves() as SketchPolyline[];
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
		const [line] = h.tool.getCurves();
		expectPoints([(line as { to: Point3 }).to], [[60_000, 0, 0]]);
	});

	it('snaps to the grid', () => {
		const h = harness();
		h.tool.configure({ gridStep: 20_000 });
		h.tool.draw('line');
		h.click(101, 99);
		h.click(158, 103);
		const [line] = h.tool.getCurves();
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
		const [curve] = h.tool.getCurves();
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
		expect(h.tool.getCurves()).toEqual([]);
	});

	it('moves a vertex with two clicks and deletes one with Delete', () => {
		const h = harness();
		h.tool.setCurves([
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
		expectPoints((h.tool.getCurves()[0] as SketchPolyline).points, [
			[0, 0, 0],
			[70_000, -20_000, 0],
			[50_000, 50_000, 0]
		]);

		h.click(100, 100);
		h.key('Delete');
		expect((h.tool.getCurves()[0] as SketchPolyline).points).toHaveLength(2);
		expect(h.changes).toHaveLength(2);
	});

	it('labels each straight segment with its length', () => {
		const h = harness();
		h.tool.setCurves([{ kind: 'line', from: [0, 0, 0], to: [1250, 0, 0] }]);
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

	it('removes everything it added on dispose', () => {
		const h = harness();
		h.tool.setCurves([{ kind: 'line', from: [0, 0, 0], to: [1000, 0, 0] }]);
		h.tool.dispose();
		expect(h.labels).toEqual([]);
		expect(h.click(100, 100)).toBe(false);
	});
});
