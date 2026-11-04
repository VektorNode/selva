import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { fitShadowToContent } from '../setup-lighting.js';

const box = (min: number, max: number) =>
	new THREE.Box3(new THREE.Vector3().setScalar(min), new THREE.Vector3().setScalar(max));

describe('fitShadowToContent', () => {
	it('keeps the sun direction through a solve with no extent', () => {
		const sun = new THREE.DirectionalLight();
		sun.position.set(3, 4, 5);

		fitShadowToContent(sun, box(2, 2));
		fitShadowToContent(sun, box(-1, 1));

		const direction = sun.position.clone().sub(sun.target.position).normalize();
		expect(direction.toArray()).toEqual(new THREE.Vector3(3, 4, 5).normalize().toArray());
	});
});
