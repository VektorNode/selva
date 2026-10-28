import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import {
	cachedSourceOf,
	canDisposeMaterial,
	disposeObjectTree,
	protectMaterials,
	shareGeometry,
	unshareGeometry
} from '../index.js';
import { borrowGeometry } from '../gpu-ownership.js';

function countingTexture(): { texture: THREE.Texture; disposals: () => number } {
	const texture = new THREE.Texture();
	let count = 0;
	texture.addEventListener('dispose', () => count++);
	return { texture, disposals: () => count };
}

describe('ownership claims', () => {
	it('a protected material is not disposable; a plain one is', () => {
		const singleton = new THREE.MeshBasicMaterial();
		protectMaterials([singleton]);
		expect(canDisposeMaterial(singleton)).toBe(false);
		expect(canDisposeMaterial(new THREE.MeshBasicMaterial())).toBe(true);
	});
});

describe('disposeObjectTree honours every claim', () => {
	it('frees every scene geometry it walks', () => {
		const root = new THREE.Group();
		const first = new THREE.BoxGeometry();
		const second = new THREE.BoxGeometry();

		let firstDisposed = false;
		let secondDisposed = false;
		first.addEventListener('dispose', () => (firstDisposed = true));
		second.addEventListener('dispose', () => (secondDisposed = true));

		root.add(new THREE.Mesh(first, new THREE.MeshBasicMaterial()));
		root.add(new THREE.Mesh(second, new THREE.MeshBasicMaterial()));
		disposeObjectTree(root);

		expect(firstDisposed).toBe(true);
		expect(secondDisposed).toBe(true);
	});

	it('does dispose a scene-owned texture', () => {
		const { texture, disposals } = countingTexture();
		const material = new THREE.MeshPhysicalMaterial();
		material.map = texture;
		const root = new THREE.Group();
		root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));

		disposeObjectTree(root);

		expect(disposals()).toBe(1);
	});

	it('materials:false frees geometry only — the solve memo path', () => {
		const { texture, disposals } = countingTexture();
		const material = new THREE.MeshPhysicalMaterial();
		material.map = texture;
		const geometry = new THREE.BoxGeometry();
		let geometryDisposed = false;
		geometry.addEventListener('dispose', () => (geometryDisposed = true));

		const root = new THREE.Group();
		root.add(new THREE.Mesh(geometry, material));
		disposeObjectTree(root, { materials: false });

		expect(geometryDisposed).toBe(true);
		expect(disposals()).toBe(0);
	});
});

describe('cached geometries', () => {
	const disposals = (geometry: THREE.BufferGeometry) => {
		const spy = vi.fn();
		geometry.addEventListener('dispose', spy);
		return spy;
	};
	const meshOf = (geometry: THREE.BufferGeometry) => {
		const root = new THREE.Group();
		root.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
		return root;
	};

	it('a plain walk leaves a cached geometry alone', () => {
		const cached = new THREE.BoxGeometry();
		shareGeometry(cached);
		const disposed = disposals(cached);

		disposeObjectTree(meshOf(cached));

		expect(disposed).not.toHaveBeenCalled();
	});

	it('teardown frees the GPU copy unless the next scene draws it, and the cache keeps it', () => {
		const shown = new THREE.BoxGeometry();
		const dropped = new THREE.BoxGeometry();
		shareGeometry(shown);
		shareGeometry(dropped);
		const shownDisposed = disposals(shown);
		const droppedDisposed = disposals(dropped);

		const root = meshOf(shown);
		root.add(new THREE.Mesh(dropped, new THREE.MeshBasicMaterial()));
		disposeObjectTree(root, { keepUploaded: new Set([shown]) });

		expect(shownDisposed).not.toHaveBeenCalled();
		expect(droppedDisposed).toHaveBeenCalledOnce();
		expect(cachedSourceOf(dropped)).toBe(dropped);
	});

	it("a borrower lets go of the cache's attributes before it is disposed", () => {
		const cached = new THREE.BoxGeometry();
		shareGeometry(cached);
		const borrower = new THREE.BufferGeometry();
		borrower.setIndex(cached.index);
		borrower.setAttribute('position', cached.getAttribute('position'));
		borrowGeometry(borrower, cached);
		let attachedAtDispose: string[] = [];
		borrower.addEventListener('dispose', () => {
			attachedAtDispose = Object.keys(borrower.attributes);
			if (borrower.index) attachedAtDispose.push('index');
		});

		disposeObjectTree(meshOf(borrower), { keepUploaded: new Set([cached]) });

		expect(attachedAtDispose).toEqual([]);
		expect(cached.getAttribute('position')).toBeDefined();
	});

	it('a borrower of an evicted geometry frees the buffers itself', () => {
		const evicted = new THREE.BoxGeometry();
		shareGeometry(evicted);
		const borrower = new THREE.BufferGeometry();
		borrower.setAttribute('position', evicted.getAttribute('position'));
		borrowGeometry(borrower, evicted);
		unshareGeometry(evicted);
		let attachedAtDispose: string[] = [];
		borrower.addEventListener(
			'dispose',
			() => (attachedAtDispose = Object.keys(borrower.attributes))
		);

		disposeObjectTree(meshOf(borrower));

		expect(attachedAtDispose).toEqual(['position']);
	});
});
