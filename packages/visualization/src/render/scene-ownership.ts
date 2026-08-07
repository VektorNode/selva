// ============================================================================
// Scene ownership: who put an object in the scene, and what may remove it
// ============================================================================
//
// A live scene mixes content from three owners: the solve (replaced wholesale every solve),
// viewer aids (grid/floor/labels, never replaced), and host apps drawing their own geometry
// alongside the solve. `userData.source` records which, and `clearScene` consults it to decide
// what a solve is allowed to destroy.
//
// App content carries an owner id (`app:<id>`) rather than a flat `'user'` so a host running
// more than one app can clear its own geometry without touching another's, and so a scoped
// solve can replace one app's results while leaving the rest standing.

import type * as THREE from 'three';

/** Geometry produced by a solve. Replaced wholesale on the next one. */
export const SOURCE_COMPUTE = 'compute';

/**
 * Host-added geometry with no owner id. Predates scoped ownership and still honoured everywhere
 * an `app:` scope is — new code should prefer {@link appSource}.
 */
export const SOURCE_USER = 'user';

const APP_PREFIX = 'app:';

/** The `userData.source` tag for geometry owned by app `id` (`'pointcloud'` → `'app:pointcloud'`). */
export function appSource(id: string): string {
	return `${APP_PREFIX}${id}`;
}

/** The app id from a source tag, or null if the tag isn't app-owned. */
export function appIdFromSource(source: unknown): string | null {
	if (typeof source !== 'string' || !source.startsWith(APP_PREFIX)) return null;
	return source.slice(APP_PREFIX.length) || null;
}

/**
 * True for anything a host added rather than the solve — `'user'` or any `app:` scope. This is
 * the predicate `clearScene` uses, so it decides what survives a solve.
 */
export function isHostOwned(object: THREE.Object3D): boolean {
	const source = object.userData?.source;
	return source === SOURCE_USER || appIdFromSource(source) !== null;
}

/**
 * True for objects owned by `id`. Passing no id matches every host-owned object, which is what
 * `clearUserGeometry()` does.
 */
export function isOwnedBy(object: THREE.Object3D, id?: string): boolean {
	if (id === undefined) return isHostOwned(object);
	return object.userData?.source === appSource(id);
}
