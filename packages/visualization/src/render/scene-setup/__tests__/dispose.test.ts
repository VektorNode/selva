import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

import { disposeMaterialWithTextures } from '../dispose';

// initThree itself needs a real WebGL canvas, so only the pure teardown helper is unit-tested here.
// The helper is what both dispose paths (final dispose() and disposeObjectTree) run per material.
describe('disposeMaterialWithTextures (issue 8)', () => {
	it('disposes the material AND every texture it references', () => {
		const map = new THREE.Texture();
		const roughnessMap = new THREE.Texture();
		const material = new THREE.MeshStandardMaterial({ map, roughnessMap });

		const mapDispose = vi.spyOn(map, 'dispose');
		const roughnessDispose = vi.spyOn(roughnessMap, 'dispose');
		const materialDispose = vi.spyOn(material, 'dispose');

		disposeMaterialWithTextures(material);

		expect(mapDispose).toHaveBeenCalledTimes(1);
		expect(roughnessDispose).toHaveBeenCalledTimes(1);
		expect(materialDispose).toHaveBeenCalledTimes(1);
	});

	it('handles texture-free materials', () => {
		const material = new THREE.MeshBasicMaterial();
		const materialDispose = vi.spyOn(material, 'dispose');

		expect(() => disposeMaterialWithTextures(material)).not.toThrow();
		expect(materialDispose).toHaveBeenCalledTimes(1);
	});
});
