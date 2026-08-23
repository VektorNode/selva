import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createVisibilityState } from '../visibility.js';
import { getStableKey } from '../identity.js';

describe('createVisibilityState', () => {
	it('hides the whole subtree, not just the root', () => {
		const parent = new THREE.Mesh();
		const child = new THREE.Mesh();
		parent.add(child);
		const state = createVisibilityState();

		state.setVisible(parent, false);

		expect(parent.visible).toBe(false);
		expect(child.visible).toBe(false);
	});

	it('tracks the hidden set as objects flip', () => {
		const mesh = new THREE.Mesh();
		const state = createVisibilityState();

		state.setVisible(mesh, false);
		expect(state.isHidden(mesh)).toBe(true);

		state.setVisible(mesh, true);
		expect(state.isHidden(mesh)).toBe(false);
		expect(mesh.visible).toBe(true);
	});

	it('uses the caller-supplied set so a host can observe it', () => {
		const hidden = new Set<string>();
		const mesh = new THREE.Mesh();

		createVisibilityState(hidden).setVisible(mesh, false);

		expect(hidden.size).toBe(1);
	});

	describe('keying', () => {
		const identified = (index: number) => {
			const mesh = new THREE.Mesh();
			mesh.userData = { sourceComponentId: 'gh-1', originalIndex: index };
			return mesh;
		};

		it('records identified objects under their stable key, not their uuid', () => {
			const hidden = new Set<string>();
			const mesh = identified(2);

			createVisibilityState(hidden).setVisible(mesh, false);

			expect([...hidden]).toEqual([getStableKey(mesh)]);
			expect(hidden.has(mesh.uuid)).toBe(false);
		});

		it('falls back to the uuid when an object has no identity', () => {
			const hidden = new Set<string>();
			const mesh = new THREE.Mesh();

			createVisibilityState(hidden).setVisible(mesh, false);

			expect([...hidden]).toEqual([mesh.uuid]);
		});

		it('recognizes a rebuilt instance of the same geometry as hidden', () => {
			const state = createVisibilityState();
			state.setVisible(identified(2), false);

			// A solve replaced the object: same Grasshopper source, new instance.
			expect(state.isHidden(identified(2))).toBe(true);
			expect(state.isHidden(identified(3))).toBe(false);
		});
	});

	describe('applyTo', () => {
		const identified = (index: number) => {
			const mesh = new THREE.Mesh();
			mesh.userData = { sourceComponentId: 'gh-1', originalIndex: index };
			return mesh;
		};

		it('re-hides geometry the user had hidden before the solve', () => {
			const state = createVisibilityState();
			state.setVisible(identified(1), false);

			const rebuilt = [identified(1), identified(2)];
			state.applyTo(rebuilt);

			expect(rebuilt[0].visible).toBe(false);
			expect(rebuilt[1].visible).toBe(true);
		});

		it('hides the whole subtree of a restored object', () => {
			const state = createVisibilityState();
			state.setVisible(identified(1), false);

			const parent = identified(1);
			const child = new THREE.Mesh();
			parent.add(child);
			state.applyTo([parent]);

			expect(child.visible).toBe(false);
		});

		it('never turns anything back on', () => {
			const state = createVisibilityState();
			// Something else (isolate mode, culling) hid this; it is not in our hidden set.
			const other = identified(9);
			other.visible = false;

			state.applyTo([other]);

			expect(other.visible).toBe(false);
		});

		it('keeps hidden keys that match nothing in the new content', () => {
			const state = createVisibilityState();
			state.setVisible(identified(1), false);

			// The definition changed and no longer produces that geometry.
			state.applyTo([identified(2)]);
			expect(state.hidden.size).toBe(1);

			// It comes back later — still hidden.
			const returned = identified(1);
			state.applyTo([returned]);
			expect(returned.visible).toBe(false);
		});

		it('does not restore uuid-keyed objects, which cannot survive a solve', () => {
			const state = createVisibilityState();
			state.setVisible(new THREE.Mesh(), false);

			const rebuilt = new THREE.Mesh();
			state.applyTo([rebuilt]);

			expect(rebuilt.visible).toBe(true);
		});
	});

	describe('layer state', () => {
		const layer = () => [new THREE.Mesh(), new THREE.Mesh(), new THREE.Mesh()];

		it('reports fully hidden only when every object is hidden', () => {
			const objects = layer();
			const state = createVisibilityState();

			state.setVisible(objects[0], false);
			expect(state.isLayerHidden(objects)).toBe(false);

			for (const o of objects) state.setVisible(o, false);
			expect(state.isLayerHidden(objects)).toBe(true);
		});

		it('reports partial only in between', () => {
			const objects = layer();
			const state = createVisibilityState();

			expect(state.isLayerPartial(objects)).toBe(false);

			state.setVisible(objects[0], false);
			expect(state.isLayerPartial(objects)).toBe(true);

			for (const o of objects) state.setVisible(o, false);
			expect(state.isLayerPartial(objects)).toBe(false);
		});

		it('treats an empty layer as neither hidden nor partial', () => {
			const state = createVisibilityState();
			expect(state.isLayerHidden([])).toBe(false);
			expect(state.isLayerPartial([])).toBe(false);
		});

		it('hides the remainder of a partially hidden layer rather than showing it', () => {
			const objects = layer();
			const state = createVisibilityState();
			state.setVisible(objects[0], false);

			state.toggleLayer(objects);

			expect(objects.every((o) => state.isHidden(o))).toBe(true);
		});

		it('shows a fully hidden layer again', () => {
			const objects = layer();
			const state = createVisibilityState();
			for (const o of objects) state.setVisible(o, false);

			state.toggleLayer(objects);

			expect(objects.some((o) => state.isHidden(o))).toBe(false);
		});
	});

	it('reset forgets hidden state without touching the objects', () => {
		const mesh = new THREE.Mesh();
		const state = createVisibilityState();
		state.setVisible(mesh, false);

		state.reset();

		expect(state.hidden.size).toBe(0);
		// The object is about to be discarded, so its flag is deliberately left alone.
		expect(mesh.visible).toBe(false);
	});
});
