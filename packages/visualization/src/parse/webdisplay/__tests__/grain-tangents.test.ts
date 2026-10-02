import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { grainTangents } from '../grain-tangents';

function run(geometry: THREE.BufferGeometry) {
	return grainTangents(
		new Float32Array(geometry.getAttribute('position').array),
		new Float32Array(geometry.getAttribute('normal').array),
		new Uint32Array(geometry.getIndex()!.array),
		new Float32Array(geometry.getAttribute('uv').array)
	);
}

function tangentAt(tangents: Float32Array, v: number) {
	return new THREE.Vector3(tangents[v * 4], tangents[v * 4 + 1], tangents[v * 4 + 2]);
}

describe('grainTangents', () => {
	it('points along increasing U, with V on the bitangent side', () => {
		const plane = new THREE.PlaneGeometry(4, 1, 4, 1); // U along +x, V along +y, normal +z
		const tangents = run(plane);
		for (let v = 0; v < tangents.length / 4; v++) {
			expect(tangentAt(tangents, v).x).toBeCloseTo(1, 5);
			expect(tangents[v * 4 + 3]).toBe(1);
		}
	});

	it('flips handedness when V is mirrored', () => {
		const plane = new THREE.PlaneGeometry(1, 1);
		const uv = plane.getAttribute('uv');
		for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
		const tangents = run(plane);
		expect(tangents[3]).toBe(-1);
	});

	it('stays finite and in-plane where V is constant', () => {
		// A tube centred on its grain axis gets constant V from a projection: three's computeTangents
		// leaves those tangents zero.
		const tube = new THREE.CylinderGeometry(1, 1, 4, 16, 1, true);
		const uv = tube.getAttribute('uv');
		const position = tube.getAttribute('position');
		for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getY(i), 0);
		const tangents = run(tube);
		const normal = tube.getAttribute('normal');
		for (let v = 0; v < uv.count; v++) {
			const t = tangentAt(tangents, v);
			expect(t.length()).toBeCloseTo(1, 5);
			expect(Math.abs(t.y)).toBeCloseTo(1, 5);
			expect(t.dot(new THREE.Vector3().fromBufferAttribute(normal, v))).toBeCloseTo(0, 5);
		}
	});

	it('falls back to a unit in-plane tangent where U is constant', () => {
		const plane = new THREE.PlaneGeometry(1, 1);
		const uv = plane.getAttribute('uv');
		for (let i = 0; i < uv.count; i++) uv.setX(i, 0);
		const tangents = run(plane);
		for (let v = 0; v < uv.count; v++) {
			const t = tangentAt(tangents, v);
			expect(t.length()).toBeCloseTo(1, 5);
			expect(t.z).toBeCloseTo(0, 5);
		}
	});
});
