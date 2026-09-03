import { describe, expect, it } from 'vitest';
import * as THREE from 'three';

import { createSceneOutliner } from '../outliner.js';

/** A merged mesh: three members, 36 indices each, as `finalizeMergedMesh` stamps them. */
function mergedMesh(layer = 'Walls') {
	const geometry = new THREE.BufferGeometry();
	geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(108), 1));
	const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
	mesh.userData = {
		name: 'north',
		layer,
		members: ['north', 'south', 'east'].map((name, i) => ({
			trackingKey: `key-${name}`,
			name,
			layer,
			metadata: {},
			indexStart: i * 36,
			indexCount: 36
		}))
	};
	return mesh;
}

function sceneWithMerged() {
	const scene = new THREE.Scene();
	const mesh = mergedMesh();
	scene.add(mesh);
	return { scene, mesh };
}

describe('scene entries', () => {
	it('expands a merged mesh into one entry per member', () => {
		const { scene, mesh } = sceneWithMerged();
		const outliner = createSceneOutliner(scene);

		const entries = outliner.entries();

		expect(entries).toHaveLength(3);
		expect(entries.map((e) => e.label)).toEqual(['north', 'south', 'east']);
		expect(entries.map((e) => e.key)).toEqual(['key-north', 'key-south', 'key-east']);
		// All three list under the one mesh that renders them.
		expect(entries.every((e) => e.object === mesh)).toBe(true);
	});

	it('lists a plain object as a single entry', () => {
		const scene = new THREE.Scene();
		const mesh = new THREE.Mesh();
		mesh.userData = { name: 'beam', layer: 'Steel' };
		scene.add(mesh);

		const entries = createSceneOutliner(scene).entries();

		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ label: 'beam', layer: 'Steel', memberIndex: null });
	});

	it('groups member entries under their layer', () => {
		const { scene } = sceneWithMerged();
		const groups = createSceneOutliner(scene).entryGroups();

		expect([...groups.keys()]).toEqual(['Walls']);
		expect(groups.get('Walls')).toHaveLength(3);
	});

	it('searches member names, not just the mesh name', () => {
		const { scene } = sceneWithMerged();
		const groups = createSceneOutliner(scene).entryGroups('south');

		expect(groups.get('Walls')?.map((e) => e.label)).toEqual(['south']);
	});
});

describe('member visibility', () => {
	it('hides one member by rebuilding the drawn ranges', () => {
		const { scene, mesh } = sceneWithMerged();
		const outliner = createSceneOutliner(scene);
		const [north, south] = outliner.entries();

		outliner.toggleEntry(south!);

		expect(outliner.visibility.isEntryHidden(south!)).toBe(true);
		expect(outliner.visibility.isEntryHidden(north!)).toBe(false);
		// The mesh still renders — as two ranges, skipping the hidden member's window.
		expect(mesh.visible).toBe(true);
		expect(mesh.geometry.groups).toEqual([
			expect.objectContaining({ start: 0, count: 36 }),
			expect.objectContaining({ start: 72, count: 36 })
		]);
	});

	it('coalesces adjacent visible members into one range', () => {
		const { scene, mesh } = sceneWithMerged();
		const outliner = createSceneOutliner(scene);
		const entries = outliner.entries();

		outliner.toggleEntry(entries[2]!); // hide the last

		expect(mesh.geometry.groups).toEqual([expect.objectContaining({ start: 0, count: 72 })]);
	});

	it('restores the untouched geometry once every member is visible again', () => {
		const { scene, mesh } = sceneWithMerged();
		const outliner = createSceneOutliner(scene);
		const [, south] = outliner.entries();

		outliner.toggleEntry(south!);
		outliner.toggleEntry(south!);

		expect(outliner.visibility.isEntryHidden(south!)).toBe(false);
		expect(mesh.geometry.groups).toHaveLength(0);
	});

	it('re-hides members after a solve rebuilds the scene', () => {
		const { scene, mesh } = sceneWithMerged();
		const outliner = createSceneOutliner(scene);
		outliner.toggleEntry(outliner.entries()[1]!);

		// A solve replaces the content with a fresh instance carrying the same tracking keys.
		scene.remove(mesh);
		const rebuilt = mergedMesh();
		scene.add(rebuilt);
		outliner.applyTo();

		expect(rebuilt.geometry.groups).toEqual([
			expect.objectContaining({ start: 0, count: 36 }),
			expect.objectContaining({ start: 72, count: 36 })
		]);
	});
});

// A collision in `key` is meaningful — the colliding things hide together — but a keyed list
// throws on it (`each_key_duplicate`), which took down the whole scene panel. `rowKey` is the
// unique one.
describe('row keys', () => {
	it('distinguishes identity-less objects that share a name and layer', () => {
		const scene = new THREE.Scene();
		for (let i = 0; i < 3; i++) {
			const mesh = new THREE.Mesh();
			mesh.userData = { name: 'beam', layer: 'Steel' };
			scene.add(mesh);
		}

		const entries = createSceneOutliner(scene).entries();

		expect(new Set(entries.map((e) => e.key)).size).toBe(1);
		expect(new Set(entries.map((e) => e.rowKey)).size).toBe(3);
	});

	it('distinguishes merged members that repeat a tracking key', () => {
		const scene = new THREE.Scene();
		scene.add(mergedMesh());
		scene.add(mergedMesh('Roof'));

		const entries = createSceneOutliner(scene).entries();

		expect(entries).toHaveLength(6);
		expect(new Set(entries.map((e) => e.rowKey)).size).toBe(6);
	});

	it('leaves the first occurrence of a key untouched', () => {
		const { scene } = sceneWithMerged();

		const entries = createSceneOutliner(scene).entries();

		expect(entries.map((e) => e.rowKey)).toEqual(entries.map((e) => e.key));
	});
});
