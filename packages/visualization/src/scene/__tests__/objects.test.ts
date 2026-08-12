import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
	getObjectLabel,
	getSceneObjects,
	getTypeLabel,
	isSceneContent,
	prettyType
} from '../objects.js';

const withUserData = (object: THREE.Object3D, data: Record<string, unknown>) => {
	object.userData = data;
	return object;
};

describe('isSceneContent', () => {
	it('accepts solve output', () => {
		expect(isSceneContent(new THREE.Mesh())).toBe(true);
	});

	it('rejects cameras and lights', () => {
		expect(isSceneContent(new THREE.PerspectiveCamera())).toBe(false);
		expect(isSceneContent(new THREE.DirectionalLight())).toBe(false);
	});

	it('rejects viewer aids by userData.id', () => {
		for (const id of ['grid', 'floor', 'label-layer', 'measure']) {
			expect(isSceneContent(withUserData(new THREE.Object3D(), { id }))).toBe(false);
		}
	});

	it('keeps an object whose id is not a helper id', () => {
		expect(isSceneContent(withUserData(new THREE.Mesh(), { id: 'wall-01' }))).toBe(true);
	});
});

describe('getSceneObjects', () => {
	it('returns content in scene-graph order, excluding aids', () => {
		const scene = new THREE.Scene();
		const a = withUserData(new THREE.Mesh(), { name: 'A' });
		const b = withUserData(new THREE.Mesh(), { name: 'B' });
		scene.add(new THREE.PerspectiveCamera());
		scene.add(a);
		scene.add(withUserData(new THREE.Object3D(), { id: 'grid' }));
		scene.add(b);

		expect(getSceneObjects(scene)).toEqual([a, b]);
	});

	it('does not descend into a mesh subtree', () => {
		const scene = new THREE.Scene();
		const parent = new THREE.Mesh();
		parent.add(new THREE.Mesh()); // an edge overlay belongs to its mesh
		scene.add(parent);

		expect(getSceneObjects(scene)).toEqual([parent]);
	});
});

describe('prettyType', () => {
	it('renames the line classes used for curves', () => {
		expect(prettyType('Line2')).toBe('Curve');
		expect(prettyType('LineSegments2')).toBe('Curve');
	});

	it('falls back to the original when stripping empties the string', () => {
		expect(prettyType('Mesh')).toBe('Mesh');
	});

	it('shortens Object3D', () => {
		expect(prettyType('Object3D')).toBe('Obj');
	});
});

describe('getObjectLabel', () => {
	it('prefers userData.name over everything else', () => {
		const mesh = withUserData(new THREE.Mesh(), { name: 'Wall', fileName: 'w.3dm' });
		mesh.name = 'three-name';
		expect(getObjectLabel(mesh)).toBe('Wall');
	});

	it('falls back through fileName, then the three name, then the type', () => {
		expect(getObjectLabel(withUserData(new THREE.Mesh(), { fileName: 'w.3dm' }))).toBe('w.3dm');

		const named = new THREE.Mesh();
		named.name = 'three-name';
		expect(getObjectLabel(named)).toBe('three-name');

		expect(getObjectLabel(new THREE.Mesh())).toBe('Mesh');
	});
});

describe('getTypeLabel', () => {
	it('returns the prettified class name', () => {
		expect(getTypeLabel(new THREE.Points())).toBe('Points');
	});
});
