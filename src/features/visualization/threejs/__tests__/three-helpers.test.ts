import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { describe, expect, it, vi } from 'vitest';

import {
	applyOffset,
	clearScene,
	computeCombinedBoundingBox,
	parseColor,
	updateScene
} from '../three-helpers';
import { METAL_MATERIAL } from '../three-materials';

function meshAt(x: number, y: number, z: number): THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
	mesh.position.set(x, y, z);
	return mesh;
}

describe('applyOffset', () => {
	it('shifts along z by default (the unified Z-up scene frame)', () => {
		// Regression: grounding used to shift position.y — sideways in a Z-up
		// scene — instead of dropping content onto the Z=0 ground plane.
		const mesh = meshAt(1, 2, 5);
		applyOffset([mesh], 3);
		expect(mesh.position.z).toBe(2);
		expect(mesh.position.x).toBe(1);
		expect(mesh.position.y).toBe(2);
	});

	it('shifts along an explicit axis', () => {
		const mesh = meshAt(0, 4, 0);
		applyOffset([mesh], 4, 'y');
		expect(mesh.position.y).toBe(0);
	});

	it('grounds content onto Z=0 when offset by the bounding-box min z', () => {
		const meshes = [meshAt(0, 0, 5), meshAt(2, 1, 8)];
		const box = computeCombinedBoundingBox(meshes);
		applyOffset(meshes, box.min.z, 'z');
		const after = computeCombinedBoundingBox(meshes);
		expect(after.min.z).toBeCloseTo(0);
	});
});

describe('parseColor', () => {
	it('parses CSS named colors', () => {
		expect(parseColor('red').getHexString()).toBe('ff0000');
		expect(parseColor('rebeccapurple').getHexString()).toBe('663399');
	});

	it('is case-insensitive for named colors', () => {
		expect(parseColor('RED').getHexString()).toBe('ff0000');
	});

	it('falls back to white for an unknown color name', () => {
		// Regression: `new THREE.Color(name)` never throws on unknown names, so the old
		// try/catch fallback was dead code and garbage silently rendered white without a warning.
		expect(parseColor('notacolorname').getHexString()).toBe('ffffff');
	});

	it('still parses hex and RGB strings', () => {
		expect(parseColor('#c7a5a5').getHexString()).toBe('c7a5a5');
		expect(parseColor('C7A5A5').getHexString()).toBe('c7a5a5');
		expect(parseColor('255, 0, 0').getHexString()).toBe('ff0000');
	});
});

/** A stand-in for OrbitControls with just the surface updateScene touches. */
function fakeControls(): OrbitControls {
	return {
		target: new THREE.Vector3(),
		minDistance: 5,
		maxDistance: 500,
		update: vi.fn()
	} as unknown as OrbitControls;
}

describe('updateScene', () => {
	it('preserves host-configured zoom limits on the initial solve', () => {
		// Regression: min/maxDistance used to be overwritten from the recomputed frustum on every
		// solve, silently discarding user-supplied zoom limits.
		const controls = fakeControls();
		updateScene(
			new THREE.Scene(),
			[meshAt(0, 0, 0)],
			new THREE.PerspectiveCamera(),
			controls,
			false
		);

		expect(controls.minDistance).toBe(5);
		expect(controls.maxDistance).toBe(500);
	});

	it('preserves host-configured zoom limits on subsequent solves', () => {
		const controls = fakeControls();
		updateScene(
			new THREE.Scene(),
			[meshAt(0, 0, 0)],
			new THREE.PerspectiveCamera(),
			controls,
			true
		);

		expect(controls.minDistance).toBe(5);
		expect(controls.maxDistance).toBe(500);
	});
});

describe('clearScene', () => {
	it('disposes per-mesh materials but never the shared singletons', () => {
		// Regression: clearing used to dispose METAL_MATERIAL et al. — shared across meshes and
		// solves — forcing a shader rebuild on their next use.
		const scene = new THREE.Scene();
		const ownMaterial = new THREE.MeshStandardMaterial();
		const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ownMaterial);
		const shared = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), METAL_MATERIAL);
		scene.add(own, shared);

		const sharedDispose = vi.spyOn(METAL_MATERIAL, 'dispose');
		const ownDispose = vi.spyOn(ownMaterial, 'dispose');
		try {
			clearScene(scene);

			expect(scene.children).toHaveLength(0); // both meshes are still removed
			expect(ownDispose).toHaveBeenCalledTimes(1);
			expect(sharedDispose).not.toHaveBeenCalled();
		} finally {
			sharedDispose.mockRestore(); // METAL_MATERIAL is module-global; leave no spy behind
			ownDispose.mockRestore();
		}
	});

	it('keeps persistent infrastructure (floor, grid, label layer)', () => {
		const scene = new THREE.Scene();
		const grid = meshAt(0, 0, 0);
		grid.userData.id = 'grid';
		const content = meshAt(1, 1, 1);
		scene.add(grid, content);

		clearScene(scene);

		expect(scene.children).toEqual([grid]);
	});
});
