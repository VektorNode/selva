import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { createGrid } from '../grid';

describe('createGrid', () => {
	it('tags the mesh so pick/fit/clear logic can skip it', () => {
		const grid = createGrid();
		expect(grid.object.userData.id).toBe('grid');
	});

	it('dispose detaches the mesh from its parent', () => {
		// Regression: dispose() freed the GPU resources but left the dead mesh in the scene graph,
		// forcing every caller to remember to detach it themselves.
		const grid = createGrid();
		const scene = new THREE.Scene();
		scene.add(grid.object);

		grid.dispose();

		expect(grid.object.parent).toBeNull();
		expect(scene.children).not.toContain(grid.object);
	});

	it('dispose is safe when the mesh was never added to a scene', () => {
		expect(() => createGrid().dispose()).not.toThrow();
	});

	it('setVisible toggles mesh visibility', () => {
		const grid = createGrid();
		grid.setVisible(false);
		expect(grid.object.visible).toBe(false);
		grid.setVisible(true);
		expect(grid.object.visible).toBe(true);
	});
});
