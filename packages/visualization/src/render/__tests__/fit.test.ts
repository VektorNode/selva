import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { FIT_MARGIN, fitDistance } from '../fit';

const Z_UP = new THREE.Vector3(0, 0, 1);
const FOV = 40;
const tanV = Math.tan((FOV * Math.PI) / 360);

/** Whether every corner of `box` projects inside the view from `distance` along `dir`. */
function inView(box: THREE.Box3, dir: THREE.Vector3, distance: number, aspect: number) {
	const center = box.getCenter(new THREE.Vector3());
	const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.01, 1e6);
	camera.up.copy(Z_UP);
	camera.position.copy(center).addScaledVector(dir.clone().normalize(), distance);
	camera.lookAt(center);
	camera.updateMatrixWorld();
	const p = new THREE.Vector3();
	let maxExtent = 0;
	for (const x of [box.min.x, box.max.x])
		for (const y of [box.min.y, box.max.y])
			for (const z of [box.min.z, box.max.z]) {
				p.set(x, y, z).project(camera);
				maxExtent = Math.max(maxExtent, Math.abs(p.x), Math.abs(p.y));
			}
	return maxExtent;
}

describe('fitDistance', () => {
	// A long, thin part (a 10 m parapet run) seen in a wide viewport.
	const part = new THREE.Box3(new THREE.Vector3(-5, -0.2, -0.1), new THREE.Vector3(5, 0.2, 0.1));
	const iso = new THREE.Vector3(-1, -1, 1).normalize();

	it('keeps every corner in view, filling the view up to the margin', () => {
		for (const aspect of [0.5, 1, 16 / 9, 2.5]) {
			const extent = inView(part, iso, fitDistance(part, iso, Z_UP, FOV, aspect), aspect);
			expect(extent).toBeLessThanOrEqual(1);
			// Tight: the widest corner sits close to the edge less the margin, not a third of the way.
			expect(extent).toBeGreaterThan(0.8);
		}
	});

	it('moves closer as the view gets wider when the width limits the fit', () => {
		const square = fitDistance(part, iso, Z_UP, FOV, 1);
		const wide = fitDistance(part, iso, Z_UP, FOV, 2.5);
		expect(wide).toBeLessThan(square * 0.8);
	});

	it('fits a cube seen along an axis from its near face', () => {
		const cube = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
		const front = new THREE.Vector3(0, -1, 0);
		expect(fitDistance(cube, front, Z_UP, FOV, 1)).toBeCloseTo((1 / tanV + 1) * FIT_MARGIN, 9);
	});

	it('handles a view straight down the up axis', () => {
		const d = fitDistance(part, Z_UP, Z_UP, FOV, 1);
		expect(Number.isFinite(d)).toBe(true);
		expect(inView(part, new THREE.Vector3(0.0001, -0.0001, 1), d, 1)).toBeLessThanOrEqual(1.001);
	});

	it('returns a finite distance for an empty box', () => {
		expect(Number.isFinite(fitDistance(new THREE.Box3(), iso, Z_UP, FOV, 1))).toBe(true);
	});
});
