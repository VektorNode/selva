import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { bvhFor, raycastVisible } from '../scene-pick';

/** A ray from z=5 straight down -Z through (x, y). */
function rayThrough(x: number, y: number): THREE.Raycaster {
	return new THREE.Raycaster(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
}

function plane(z: number): THREE.Mesh {
	const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
	mesh.position.z = z;
	return mesh;
}

function sceneOf(...objects: THREE.Object3D[]): THREE.Scene {
	const scene = new THREE.Scene();
	scene.add(...objects);
	scene.updateMatrixWorld(true);
	return scene;
}

describe('raycastVisible', () => {
	it('returns the nearest mesh hit in world space', () => {
		const scene = sceneOf(plane(0), plane(1));
		const [first] = raycastVisible(scene, rayThrough(0.2, 0.3));

		expect(first?.point.z).toBeCloseTo(1, 5);
		expect(first?.distance).toBeCloseTo(4, 5);
		expect(first?.face).toBeTruthy();
	});

	it('skips meshes inside a hidden group', () => {
		const group = new THREE.Group();
		group.visible = false;
		group.add(plane(1));
		const scene = sceneOf(group, plane(0));

		const [first] = raycastVisible(scene, rayThrough(0, 0));
		expect(first?.point.z).toBeCloseTo(0, 5);
	});

	it('skips viewer aids', () => {
		const aid = plane(1);
		aid.userData.id = 'grid';
		const scene = sceneOf(aid);

		expect(raycastVisible(scene, rayThrough(0, 0))).toHaveLength(0);
	});

	it('skips triangles outside the drawn groups of a merged mesh', () => {
		// PlaneGeometry(2, 2) is two triangles: index 0..2 and 3..5. Drawing only the second hides
		// the first, the way merged-draw hides a member.
		const mesh = plane(0);
		const faceAt = (x: number, y: number) => rayThrough(x, y).intersectObject(mesh)[0]?.faceIndex;
		mesh.updateMatrixWorld(true);
		const [x0, y0] = faceAt(-0.5, 0.5) === 1 ? [-0.5, 0.5] : [0.5, -0.5];
		const [x1, y1] = x0 === -0.5 ? [0.5, -0.5] : [-0.5, 0.5];

		mesh.geometry.addGroup(3, 3, 0);
		mesh.material = [new THREE.MeshBasicMaterial()];
		const scene = sceneOf(mesh);

		expect(raycastVisible(scene, rayThrough(x0, y0))).toHaveLength(1);
		expect(raycastVisible(scene, rayThrough(x1, y1))).toHaveLength(0);
	});

	it('leaves the index buffer untouched, so merged-member windows stay valid', () => {
		const geometry = new THREE.PlaneGeometry(2, 2, 8, 8);
		const before = Array.from(geometry.index!.array);
		bvhFor(geometry);
		expect(Array.from(geometry.index!.array)).toEqual(before);
	});

	it('reuses one BVH across geometries sharing attributes', () => {
		const geometry = new THREE.PlaneGeometry(2, 2);
		const twin = new THREE.BufferGeometry();
		twin.setIndex(geometry.index);
		twin.setAttribute('position', geometry.attributes.position!);

		expect(bvhFor(twin)).toBe(bvhFor(geometry));
	});
});
