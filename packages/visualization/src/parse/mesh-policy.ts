// Mesh ownership policy for `@selvajs/solve`'s result memo: `SolveResult<TMesh>` is opaque to the
// memo, so clone/release are injected here instead. The viewer disposes whatever it last rendered
// (`clearScene`), so a memo handing out live references would serve a disposed object on the next
// hit — `clone` copies geometry explicitly (`Object3D.clone()` shares it by reference) but leaves
// materials shared, since `clearScene` already spares `SHARED_MATERIALS` singletons and recompiling
// per-mesh materials as shaders is expensive.

import * as THREE from 'three';

import { disposeObjectTree } from '../shared/index.js';

export function cloneSceneObjects(meshes: THREE.Object3D[]): THREE.Object3D[] {
	return meshes.map((root) => {
		const copy = root.clone(true);
		const sources: THREE.Object3D[] = [];
		root.traverse((child) => sources.push(child));
		let i = 0;
		copy.traverse((child) => {
			const source = sources[i++] as Partial<THREE.Mesh> & THREE.Object3D;
			const target = child as Partial<THREE.Mesh> & THREE.Object3D;
			if (!source.geometry) return;
			target.geometry = source.geometry.clone();
		});
		return copy;
	});
}

/** Skips materials — the memo never owns those; see the file header. */
export function releaseSceneObjects(meshes: THREE.Object3D[]): void {
	meshes.forEach((root) => disposeObjectTree(root, { materials: false }));
}

/** Geometry bytes only: the memo's copies share materials and textures with the live scene. */
export function sceneObjectsByteSize(meshes: THREE.Object3D[]): number {
	let bytes = 0;
	const seen = new Set<THREE.BufferGeometry>();
	for (const root of meshes) {
		root.traverse((child) => {
			const geometry = (child as Partial<THREE.Mesh>).geometry;
			if (!geometry || seen.has(geometry)) return;
			seen.add(geometry);
			for (const attribute of Object.values(geometry.attributes)) {
				bytes += (attribute as THREE.BufferAttribute).array.byteLength;
			}
			if (geometry.index) bytes += geometry.index.array.byteLength;
		});
	}
	return bytes;
}

/** Structurally, not nominally, typed as `@selvajs/solve/client`'s `MeshPolicy<THREE.Object3D>` — avoids a dependency on solve. */
export const meshPolicy: {
	clone(meshes: THREE.Object3D[]): THREE.Object3D[];
	release(meshes: THREE.Object3D[]): void;
	byteSize(meshes: THREE.Object3D[]): number;
} = {
	clone: cloneSceneObjects,
	release: releaseSceneObjects,
	byteSize: sceneObjectsByteSize
};
