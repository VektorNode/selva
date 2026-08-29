import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
	highlightMemberRange,
	memberBounds,
	resolveHitMember,
	type PickableMember
} from '../scene-setup/merged-picking';

/** Three boxes concatenated: 12 triangles (36 indices) each, in member order. */
function mergedMesh(): { mesh: THREE.Mesh; members: PickableMember[] } {
	const members: PickableMember[] = ['wall', 'door', 'roof'].map((name, i) => ({
		trackingKey: `key-${name}`,
		name,
		layer: 'Building',
		metadata: { 'Ifc.Name': name },
		indexStart: i * 36,
		indexCount: 36
	}));

	const positions = new Float32Array(3 * 8 * 3);
	const indices = new Uint32Array(3 * 36);
	for (let m = 0; m < 3; m++) {
		const box = new THREE.BoxGeometry(1, 1, 1).translate(m * 10, 0, 0).toNonIndexed();
		const src = box.getAttribute('position').array as Float32Array;
		for (let i = 0; i < 36; i++) indices[m * 36 + i] = m * 8 + (i % 8);
		positions.set(src.subarray(0, 24), m * 24);
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
	geometry.setIndex(new THREE.BufferAttribute(indices, 1));

	const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
	mesh.userData = { members };
	return { mesh, members };
}

function hitOn(mesh: THREE.Mesh, faceIndex: number): THREE.Intersection {
	return { object: mesh, faceIndex, distance: 1, point: new THREE.Vector3() } as THREE.Intersection;
}

describe('resolveHitMember', () => {
	it('maps a face in each member window back to that member', () => {
		const { mesh, members } = mergedMesh();

		// First face of each member: faces 0, 12, 24 (36 indices / 3 per face).
		expect(resolveHitMember(hitOn(mesh, 0))?.member).toBe(members[0]);
		expect(resolveHitMember(hitOn(mesh, 12))?.member).toBe(members[1]);
		expect(resolveHitMember(hitOn(mesh, 24))?.member).toBe(members[2]);
	});

	it('maps the last face of a window to that member, not the next one', () => {
		const { mesh, members } = mergedMesh();
		expect(resolveHitMember(hitOn(mesh, 11))?.member).toBe(members[0]);
		expect(resolveHitMember(hitOn(mesh, 23))?.member).toBe(members[1]);
	});

	it('returns null for a plain mesh with no members', () => {
		const plain = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
		expect(resolveHitMember(hitOn(plain, 0))).toBeNull();
	});

	it('returns null when the hit carries no face', () => {
		const { mesh } = mergedMesh();
		const hit = { object: mesh, distance: 1, point: new THREE.Vector3() } as THREE.Intersection;
		expect(resolveHitMember(hit)).toBeNull();
	});

	it('returns null past the end of the last window', () => {
		const { mesh } = mergedMesh();
		expect(resolveHitMember(hitOn(mesh, 999))).toBeNull();
	});
});

describe('highlightMemberRange', () => {
	it('draws only the member range with the highlight material', () => {
		const { mesh, members } = mergedMesh();
		const base = mesh.material as THREE.Material;
		const highlight = new THREE.MeshStandardMaterial();

		highlightMemberRange(mesh, members[1]!, highlight);

		expect(mesh.material).toEqual([base, highlight]);
		const highlighted = mesh.geometry.groups.filter((g) => g.materialIndex === 1);
		expect(highlighted).toHaveLength(1);
		expect(highlighted[0]).toMatchObject({ start: 36, count: 36 });
	});

	it('restores the original material and groups', () => {
		const { mesh, members } = mergedMesh();
		const base = mesh.material;

		const restore = highlightMemberRange(mesh, members[0]!, new THREE.MeshStandardMaterial());
		restore();

		expect(mesh.material).toBe(base);
		expect(mesh.geometry.groups).toHaveLength(0);
	});

	it('is a no-op for a member without an index window', () => {
		const { mesh } = mergedMesh();
		const base = mesh.material;
		const member: PickableMember = { name: 'x', layer: '', metadata: {} };

		highlightMemberRange(mesh, member, new THREE.MeshStandardMaterial());

		expect(mesh.material).toBe(base);
	});
});

describe('memberBounds', () => {
	it('bounds one member, not the whole merged mesh', () => {
		const { mesh, members } = mergedMesh();

		const whole = new THREE.Box3().setFromObject(mesh);
		const one = memberBounds(mesh, members[0]!);

		expect(one.isEmpty()).toBe(false);
		expect(one.getSize(new THREE.Vector3()).x).toBeLessThan(whole.getSize(new THREE.Vector3()).x);
	});
});
