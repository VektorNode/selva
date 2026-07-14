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

	describe('fitToContent', () => {
		const uniforms = (grid: ReturnType<typeof createGrid>) =>
			(grid.object.material as THREE.ShaderMaterial).uniforms;

		it('scales cell size to a nice 1/2/5 step aiming ~20 cells across the part', () => {
			const grid = createGrid({ plane: 'z' }); // grids over x,y
			// A ~3000-unit-wide part (the mm-as-meters DFF case): 3000/20 = 150 → nice step 100.
			grid.fitToContent(
				new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3000, 1500, 170))
			);
			expect(uniforms(grid).uCell.value).toBe(100);
		});

		it('scales cell size down for a small part', () => {
			const grid = createGrid({ plane: 'z' });
			// A 3-unit part: 3/20 = 0.15 → nice step 0.1.
			grid.fitToContent(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3, 2, 1)));
			expect(uniforms(grid).uCell.value).toBe(0.1);
		});

		it('extends the fade radius past the part so the grid has no visible edge', () => {
			const grid = createGrid({ plane: 'z', fadeDistance: 100 });
			grid.fitToContent(
				new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(3000, 1500, 0))
			);
			// Fade reaches ~2× the in-plane extent (3000) → 6000, far past the default 100.
			expect(uniforms(grid).uFade.value).toBe(6000);
		});

		it('measures the two in-plane axes only, so a tall thin part is sized by its footprint', () => {
			const grid = createGrid({ plane: 'z' }); // in-plane axes are x,y; z (height) ignored
			grid.fitToContent(new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 5000)));
			// Footprint extent is 2, not the 5000 height → 2/20 = 0.1 → nice step 0.1.
			expect(uniforms(grid).uCell.value).toBe(0.1);
		});

		it('is a no-op on empty bounds — keeps the constructor scale', () => {
			const grid = createGrid({ cellSize: 1, fadeDistance: 100 });
			grid.fitToContent(new THREE.Box3()); // empty
			expect(uniforms(grid).uCell.value).toBe(1);
			expect(uniforms(grid).uFade.value).toBe(100);
		});
	});
});
