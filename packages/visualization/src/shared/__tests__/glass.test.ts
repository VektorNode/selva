import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { GLASS, hideGlass } from '../glass.js';

describe('hideGlass', () => {
	it('hides only visible glass, and shows exactly that again', () => {
		const glassMaterial = new THREE.MeshStandardMaterial();
		glassMaterial.userData[GLASS] = true;
		const pane = new THREE.Mesh(new THREE.BufferGeometry(), glassMaterial);
		const hiddenPane = new THREE.Mesh(new THREE.BufferGeometry(), glassMaterial);
		hiddenPane.visible = false;
		const wall = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial());
		const scene = new THREE.Scene().add(pane, hiddenPane, wall);

		const show = hideGlass(scene);
		expect([pane.visible, hiddenPane.visible, wall.visible]).toEqual([false, false, true]);

		show();
		expect([pane.visible, hiddenPane.visible, wall.visible]).toEqual([true, false, true]);
	});
});
