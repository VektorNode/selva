// The three.js mesh ownership policy for `@selvajs/solve`'s client-side result memo (M2).
//
// The memo caches whole solve results, but it deliberately does not know what a mesh is —
// `SolveResult<TMesh>` is opaque there and the clone/release rules are injected. This is that
// injection for a three.js host, and it lives here because the rules it encodes are the
// renderer's, not the cache's:
//
//   - The viewer takes ownership of every mesh array it renders; `clearScene` disposes the
//     previous content on the next scene update. So a memo that retained the objects it handed
//     out would serve a disposed corpse on the next hit — audit C1, the bug this exists to
//     prevent. `clone` gives every recipient its own copies.
//   - `Object3D.clone()` copies the transform hierarchy but SHARES `geometry` and `material` by
//     reference, which is precisely the aliasing that makes a naive clone useless. Geometry is
//     therefore copied explicitly.
//   - Materials are deliberately left shared: `clearScene` spares anything in `SHARED_MATERIALS`
//     (module-scope singletons reused across solves), and per-mesh materials are cheap to
//     recreate but expensive to re-compile as shader programs.

import * as THREE from 'three';

import { CACHED_GEOMETRY_USERDATA_FLAG, disposeObjectTree } from '../shared/index.js';

/**
 * A three.js object graph the caller owns outright: transforms cloned, geometry copied,
 * materials shared.
 *
 * The copied geometry drops {@link CACHED_GEOMETRY_USERDATA_FLAG} even when the source carried
 * it. The flag means "the cross-solve geometry cache owns these GPU buffers, don't dispose
 * them" — true of the cache's instance, false of a private copy of it. Left in place it would
 * make both `clearScene` and {@link releaseSceneObjects} skip the copy, and nothing else holds
 * a reference: the buffers would leak.
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
 * would free a singleton still referenced by live scene content.
 *
 * Cache-owned geometries are skipped for the same reason `clearScene` skips them: the
 * cross-solve geometry cache disposes on its own eviction. A memo entry should never contain one
 * (its geometries come from {@link cloneSceneObjects}, which strips the flag), so this is a
 * guard against a caller that stores uncloned meshes, not an expected path.
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
