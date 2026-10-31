import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { describe, expect, it, vi } from 'vitest';

import { createHoverOutline } from '../scene-setup/hover-outline';
import { setHiddenMembers } from '../../shared/index.js';

/** Records what the mask pass drew; no GL context exists under `environment: 'node'`. */
function fakeRenderer() {
	const drawn: { start: number; count: number; matrix: THREE.Matrix4 }[] = [];
	const renderer = {
		autoClear: true,
		getDrawingBufferSize: (target: THREE.Vector2) => target.set(800, 600),
		getPixelRatio: () => 2,
		getClearAlpha: () => 1,
		getClearColor: (target: THREE.Color) => target,
		setClearColor: vi.fn(),
		setRenderTarget: vi.fn(),
		clear: vi.fn(),
		render: (object: THREE.Mesh) => {
			if (object.geometry.getAttribute('position')?.count > 3) {
				const { start, count } = object.geometry.drawRange;
				drawn.push({ start, count, matrix: object.matrixWorld.clone() });
			}
		}
	};
	return { renderer: renderer as unknown as THREE.WebGLRenderer, drawn };
}

function mergedMesh() {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
	mesh.userData.members = [
		{ name: 'a', layer: '', metadata: {}, indexStart: 0, indexCount: 12 },
		{ name: 'b', layer: '', metadata: {}, indexStart: 12, indexCount: 24 }
	];
	return mesh;
}

const camera = new THREE.PerspectiveCamera();

describe('createHoverOutline', () => {
	it('draws one member, not the whole merged mesh', () => {
		const { renderer, drawn } = fakeRenderer();
		const outline = createHoverOutline(renderer);

		expect(outline.show(mergedMesh(), 1)).toBe(true);
		outline.render(camera);

		expect(drawn).toMatchObject([{ start: 12, count: 24 }]);
	});

	it('draws a plain mesh in place', () => {
		const { renderer, drawn } = fakeRenderer();
		const outline = createHoverOutline(renderer);
		const mesh = new THREE.Mesh(new THREE.BoxGeometry());
		mesh.position.set(5, 0, 0);

		outline.show(mesh, null);
		outline.render(camera);

		expect(drawn[0]!.count).toBe(Infinity);
		expect(new THREE.Vector3().setFromMatrixPosition(drawn[0]!.matrix).x).toBe(5);
	});

	it('refuses what has no surface of its own to outline', () => {
		const { renderer, drawn } = fakeRenderer();
		const outline = createHoverOutline(renderer);

		expect(outline.show(new THREE.Line(new THREE.BufferGeometry()), null)).toBe(false);
		expect(outline.show(new LineSegments2(), null)).toBe(false);
		expect(outline.show(new THREE.InstancedMesh(new THREE.BoxGeometry(), undefined, 2), null)).toBe(
			false
		);

		outline.render(camera);
		expect(drawn).toEqual([]);
	});

	it('stops once the hovered thing is hidden, without being told', () => {
		const { renderer, drawn } = fakeRenderer();
		const outline = createHoverOutline(renderer);
		const mesh = mergedMesh();

		outline.show(mesh, 0);
		setHiddenMembers(mesh, new Set([0]));
		outline.render(camera);

		expect(drawn).toEqual([]);
	});
});
