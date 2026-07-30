// Mesh ownership policy for `@selvajs/solve`'s result memo: `SolveResult<TMesh>` is opaque to the
// memo, so clone/release are injected. Rules encoded here, not in the cache, because they're the
// renderer's: the viewer disposes whatever it last rendered (`clearScene`), so a memo that handed
// out live references would serve a disposed object on the next hit. `clone` copies geometry
// explicitly (`Object3D.clone()` shares it by reference — a naive clone would still alias) but
// leaves materials shared, since `clearScene` already spares `SHARED_MATERIALS` singletons and
// per-mesh materials are expensive to recompile as shaders.

import * as THREE from 'three';

import { CACHED_GEOMETRY_USERDATA_FLAG, disposeObjectTree } from '../shared/index.js';

/**
 * A three.js object graph the caller owns outright: transforms cloned, geometry copied,
 * materials shared.
 *
 * The copy drops {@link CACHED_GEOMETRY_USERDATA_FLAG} even when the source carries it — the flag
 * means "the geometry cache owns these buffers," true of the cache's instance but not of a
 * private copy. Left in place, both `clearScene` and {@link releaseSceneObjects} would skip
 * disposing the copy and its buffers would leak.
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
			const geometry = source.geometry.clone();
			// `BufferGeometry.clone()` carries userData across, flag included — and it assigns the
			// SAME object, not a copy. Deleting the flag off it in place would un-flag the source
			// too, and `clearScene` would then dispose GPU buffers the geometry cache still owns.
			// Shallow-copy first, then drop the flag from the copy's own userData.
			geometry.userData = { ...geometry.userData };
			delete geometry.userData[CACHED_GEOMETRY_USERDATA_FLAG];
			target.geometry = geometry;
		});
		return copy;
	});
}

/**
 * Release the GPU buffers of objects the memo owns. Mirrors `clearScene`'s traversal, minus
 * materials — the memo never owns those (see {@link cloneSceneObjects}), so disposing one here
 * would free a singleton still referenced by live scene content. Cache-owned geometries are
 * skipped too (a memo entry should never contain one, since {@link cloneSceneObjects} strips the
 * flag — this guards a caller that stores uncloned meshes, not an expected path).
 */
export function releaseSceneObjects(meshes: THREE.Object3D[]): void {
	// `materials: false` is the memo-specific part; the ownership rules (skip cache-owned geometry)
	// come from the one shared walker, so they can't drift from `clearScene`'s.
	meshes.forEach((root) => disposeObjectTree(root, { materials: false }));
}

/**
 * The mesh ownership policy to hand `@selvajs/solve/client` — `createRequestResponseDriver`
 * and `createSolveMemo` both accept it as `meshPolicy`. Structural, not nominal: it satisfies
 * solve's `MeshPolicy<THREE.Object3D>` without this package depending on solve.
 *
 * ```ts
 * import { meshPolicy } from '@selvajs/visualization/parse';
 * const driver = createRequestResponseDriver(onSolve, () => session, { meshPolicy });
 * ```
 */
export const meshPolicy: {
	clone(meshes: THREE.Object3D[]): THREE.Object3D[];
	release(meshes: THREE.Object3D[]): void;
} = {
	clone: cloneSceneObjects,
	release: releaseSceneObjects
};
