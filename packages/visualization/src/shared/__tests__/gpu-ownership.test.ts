import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { canDisposeMaterial, disposeObjectTree, protectMaterials } from '../index.js';

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
