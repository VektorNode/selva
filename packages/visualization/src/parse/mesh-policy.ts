// Mesh ownership policy for `@selvajs/solve`'s result memo: `SolveResult<TMesh>` is opaque to the
// memo, so clone/release are injected here instead. The viewer disposes whatever it last rendered
// (`clearScene`), so a memo handing out live references would serve a disposed object on the next
// hit — `clone` copies geometry explicitly (`Object3D.clone()` shares it by reference) but leaves
// materials shared, since `clearScene` already spares `SHARED_MATERIALS` singletons and recompiling
// per-mesh materials as shaders is expensive.

import * as THREE from 'three';

import { disposeObjectTree } from '../shared/index.js';

/**
 * A three.js object graph the caller owns outright: transforms cloned, geometry copied,
 * materials shared.
 */
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

/**
 * Release the GPU buffers of objects the memo owns. Mirrors `clearScene`'s traversal, minus
 * materials — the memo never owns those (see {@link cloneSceneObjects}).
 */
export function releaseSceneObjects(meshes: THREE.Object3D[]): void {
	meshes.forEach((root) => disposeObjectTree(root, { materials: false }));
}

/**
 * Structural, not nominal: satisfies `@selvajs/solve/client`'s `MeshPolicy<THREE.Object3D>`
 * without this package depending on solve.
 */
export const meshPolicy: {
	clone(meshes: THREE.Object3D[]): THREE.Object3D[];
	release(meshes: THREE.Object3D[]): void;
} = {
	clone: cloneSceneObjects,
	release: releaseSceneObjects
};
