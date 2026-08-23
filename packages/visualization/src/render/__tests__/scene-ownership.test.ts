import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
	appIdFromSource,
	appSource,
	isHostOwned,
	isOwnedBy,
	SOURCE_COMPUTE,
	SOURCE_USER
} from '../scene-ownership';
import { clearScene } from '../three-helpers';

function objectWithSource(source?: string): THREE.Object3D {
	const object = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
	if (source !== undefined) object.userData.source = source;
	return object;
}

describe('scene ownership tags', () => {
	it('round-trips an app id', () => {
		expect(appIdFromSource(appSource('pointcloud'))).toBe('pointcloud');
	});

	it('reads no app id from compute, user, or a non-string tag', () => {
		expect(appIdFromSource(SOURCE_COMPUTE)).toBeNull();
		expect(appIdFromSource(SOURCE_USER)).toBeNull();
		expect(appIdFromSource(undefined)).toBeNull();
		expect(appIdFromSource(42)).toBeNull();
		// Bare prefix carries no id, so it names no app.
		expect(appIdFromSource('app:')).toBeNull();
	});

	it('treats both plain user geometry and any app scope as host-owned', () => {
		expect(isHostOwned(objectWithSource(SOURCE_USER))).toBe(true);
		expect(isHostOwned(objectWithSource(appSource('lines')))).toBe(true);
		expect(isHostOwned(objectWithSource(SOURCE_COMPUTE))).toBe(false);
		expect(isHostOwned(objectWithSource())).toBe(false);
	});

	it('scopes isOwnedBy to one app, and matches everything host-owned without an id', () => {
		const lines = objectWithSource(appSource('lines'));
		const cloud = objectWithSource(appSource('cloud'));
		const legacy = objectWithSource(SOURCE_USER);

		expect(isOwnedBy(lines, 'lines')).toBe(true);
		expect(isOwnedBy(cloud, 'lines')).toBe(false);
		// A scoped clear must not sweep up untagged host geometry.
		expect(isOwnedBy(legacy, 'lines')).toBe(false);

		expect(isOwnedBy(lines)).toBe(true);
		expect(isOwnedBy(legacy)).toBe(true);
	});
});

describe('clearScene ownership', () => {
	it('drops compute content but keeps every host-owned object', () => {
		const scene = new THREE.Scene();
		const compute = objectWithSource(SOURCE_COMPUTE);
		const legacy = objectWithSource(SOURCE_USER);
		const app = objectWithSource(appSource('cloud'));
		scene.add(compute, legacy, app);

		clearScene(scene);

		expect(scene.children).toContain(legacy);
		expect(scene.children).toContain(app);
		expect(scene.children).not.toContain(compute);
	});
});
