import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
	CACHED_GEOMETRY_USERDATA_FLAG,
	CACHED_TEXTURE_USERDATA_FLAG,
	canDisposeGeometry,
	canDisposeMaterial,
	canDisposeTexture,
	disposeMaterial,
	disposeObjectTree,
	protectMaterials
} from '../index.js';

// ============================================================================
// The ownership rule: exactly one owner per GPU resource, and every disposal
// path asks rather than remembers.
//
// Two leaks (F1, and the texture case found auditing it) both came from a
// walker that didn't know about a cache's ownership claim. These tests pin the
// claims themselves, so a fifth cache added later fails loudly if unclaimed.
// ============================================================================

/** A texture that reports how many times it was actually freed. */
function countingTexture(): { texture: THREE.Texture; disposals: () => number } {
	const texture = new THREE.Texture();
	let count = 0;
	texture.addEventListener('dispose', () => count++);
	return { texture, disposals: () => count };
}

describe('ownership claims', () => {
	it('cache-owned geometry is not scene-disposable; a plain one is', () => {
		const cached = new THREE.BoxGeometry();
		cached.userData[CACHED_GEOMETRY_USERDATA_FLAG] = true;
		expect(canDisposeGeometry(cached)).toBe(false);
		expect(canDisposeGeometry(new THREE.BoxGeometry())).toBe(true);
	});

	it('cache-owned texture is not scene-disposable; a plain one is', () => {
		const cached = new THREE.Texture();
		cached.userData[CACHED_TEXTURE_USERDATA_FLAG] = true;
		expect(canDisposeTexture(cached)).toBe(false);
		expect(canDisposeTexture(new THREE.Texture())).toBe(true);
	});

	it('a protected material is not disposable; a plain one is', () => {
		const singleton = new THREE.MeshBasicMaterial();
		protectMaterials([singleton]);
		expect(canDisposeMaterial(singleton)).toBe(false);
		expect(canDisposeMaterial(new THREE.MeshBasicMaterial())).toBe(true);
	});
});

describe('disposeObjectTree honours every claim', () => {
	it('frees scene-owned geometry, spares cache-owned', () => {
		const root = new THREE.Group();
		const owned = new THREE.BoxGeometry();
		const cached = new THREE.BoxGeometry();
		cached.userData[CACHED_GEOMETRY_USERDATA_FLAG] = true;

		let ownedDisposed = false;
		let cachedDisposed = false;
		owned.addEventListener('dispose', () => (ownedDisposed = true));
		cached.addEventListener('dispose', () => (cachedDisposed = true));

		root.add(new THREE.Mesh(owned, new THREE.MeshBasicMaterial()));
		root.add(new THREE.Mesh(cached, new THREE.MeshBasicMaterial()));
		disposeObjectTree(root);

		expect(ownedDisposed).toBe(true);
		expect(cachedDisposed).toBe(false);
	});

	it('does NOT dispose a cache-owned texture shared with other materials', () => {
		// The bug this pins: `material.map = cachedTexture` shares one instance across every
		// material using that URL. Before the claim existed, the first sweep freed it while the
		// cache still held and served it.
		const { texture, disposals } = countingTexture();
		texture.userData[CACHED_TEXTURE_USERDATA_FLAG] = true;

		const material = new THREE.MeshPhysicalMaterial();
		material.map = texture;
		const root = new THREE.Group();
		root.add(new THREE.Mesh(new THREE.BoxGeometry(), material));

		disposeObjectTree(root);

		expect(disposals()).toBe(0);
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

	it('onGeometry sees every geometry, including ones it must not dispose', () => {
		// The edge-cache hook (F1) relies on this: cache-owned geometries still need their
		// derived line geometries released, even though the geometry itself is spared.
		const cached = new THREE.BoxGeometry();
		cached.userData[CACHED_GEOMETRY_USERDATA_FLAG] = true;
		const plain = new THREE.BoxGeometry();

		const seen: THREE.BufferGeometry[] = [];
		const root = new THREE.Group();
		root.add(new THREE.Mesh(cached, new THREE.MeshBasicMaterial()));
		root.add(new THREE.Mesh(plain, new THREE.MeshBasicMaterial()));

		disposeObjectTree(root, { onGeometry: (g) => seen.push(g) });

		expect(seen).toHaveLength(2);
		expect(seen).toContain(cached);
	});
});

describe('disposeMaterial', () => {
	it('spares a protected material and its textures entirely', () => {
		const { texture, disposals } = countingTexture();
		const singleton = new THREE.MeshPhysicalMaterial();
		singleton.map = texture;
		protectMaterials([singleton]);

		disposeMaterial(singleton);

		expect(disposals()).toBe(0);
	});
});
