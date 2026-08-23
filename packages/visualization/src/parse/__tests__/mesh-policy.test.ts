import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { cloneSceneObjects, meshPolicy, releaseSceneObjects } from '../mesh-policy.js';

// `@selvajs/solve`'s result memo keeps meshes opaque and injects these rules, so this is the
// only place the actual clone/dispose semantics are pinned — the memo's suite proves it CALLS
// a policy, this proves the policy is correct.

function meshWithChild(): THREE.Mesh {
	const parent = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
	parent.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
	return parent;
}

describe('cloneSceneObjects', () => {
	it('returns different objects with different geometries', () => {
		const source = meshWithChild();
		const [copy] = cloneSceneObjects([source]);

		expect(copy).not.toBe(source);
		expect((copy as THREE.Mesh).geometry).not.toBe(source.geometry);
	});

	it('copies geometry through the whole subtree, not just the root', () => {
		// `Object3D.clone(true)` clones the hierarchy but SHARES geometry by reference — a child
		// left aliased would be disposed by whoever owns the other copy.
		const source = meshWithChild();
		const [copy] = cloneSceneObjects([source]);

		const sourceChild = source.children[0] as THREE.Mesh;
		const copyChild = copy.children[0] as THREE.Mesh;
		expect(copyChild.geometry).not.toBe(sourceChild.geometry);
		expect(copyChild.geometry.attributes.position).toBeDefined();
	});

	it('shares materials deliberately (clearScene spares shared ones; recompiling is expensive)', () => {
		const source = meshWithChild();
		const [copy] = cloneSceneObjects([source]);
		expect((copy as THREE.Mesh).material).toBe(source.material);
	});

	it('preserves the transform', () => {
		const source = meshWithChild();
		source.position.set(1, 2, 3);
		const [copy] = cloneSceneObjects([source]);
		expect(copy.position.toArray()).toEqual([1, 2, 3]);
	});

	it('handles objects with no geometry (groups, lights)', () => {
		const group = new THREE.Group();
		group.add(meshWithChild());
		const [copy] = cloneSceneObjects([group]);
		expect(copy).not.toBe(group);
		expect((copy.children[0] as THREE.Mesh).geometry).not.toBe(
			(group.children[0] as THREE.Mesh).geometry
		);
	});
});

describe('releaseSceneObjects', () => {
	it('disposes geometry through the whole subtree', () => {
		const mesh = meshWithChild();
		const root = vi.spyOn(mesh.geometry, 'dispose');
		const child = vi.spyOn((mesh.children[0] as THREE.Mesh).geometry, 'dispose');

		releaseSceneObjects([mesh]);

		expect(root).toHaveBeenCalled();
		expect(child).toHaveBeenCalled();
	});

	it('never disposes materials (they are shared with live scene content)', () => {
		const mesh = meshWithChild();
		const material = vi.spyOn(mesh.material as THREE.Material, 'dispose');

		releaseSceneObjects([mesh]);

		expect(material).not.toHaveBeenCalled();
	});

	it('round-trips: a clone survives the original being released', () => {
		// End to end: the memo stores a clone, the viewer disposes what it was given, and the
		// next hit must still be renderable.
		const stored = cloneSceneObjects([meshWithChild()]);
		const served = meshPolicy.clone(stored);

		meshPolicy.release(served); // the viewer eats its copy

		expect((stored[0] as THREE.Mesh).geometry.attributes.position).toBeDefined();
		expect(meshPolicy.clone(stored)[0]).not.toBe(served[0]);
	});
});
