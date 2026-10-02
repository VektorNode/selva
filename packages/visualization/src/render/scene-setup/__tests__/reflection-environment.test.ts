import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { disposeMaterial, LOOK_PRESETS } from '../../../shared/index.js';
import { SOURCE_COMPUTE } from '../../scene-ownership.js';
import { applyMaterialOverride } from '../appearance.js';
import {
	applyReflectionEnvironment,
	installReflectionEnvironment
} from '../reflection-environment.js';

function solveMesh(metalness: number) {
	const mesh = new THREE.Mesh(
		new THREE.BufferGeometry(),
		new THREE.MeshPhysicalMaterial({ metalness })
	);
	mesh.userData.source = SOURCE_COMPUTE;
	return mesh;
}

function setup() {
	const scene = new THREE.Scene();
	const studio = new THREE.Texture();
	installReflectionEnvironment(scene, studio, new THREE.Euler(Math.PI / 2, 0, 0));
	return { scene, studio };
}

describe('reflection environment', () => {
	it('gives metals the studio probe and leaves dielectrics on the scene environment', () => {
		const { scene, studio } = setup();
		const metal = solveMesh(1);
		const paint = solveMesh(0);
		scene.add(metal, paint);
		applyReflectionEnvironment(scene, scene);

		const metalMaterial = metal.material as THREE.MeshPhysicalMaterial;
		expect(metalMaterial.envMap).toBe(studio);
		expect(metalMaterial.envMapRotation.x).toBeCloseTo(Math.PI / 2);
		expect((paint.material as THREE.MeshPhysicalMaterial).envMap).toBeNull();
	});

	it('follows a look that zeroes metalness, and back', () => {
		const { scene, studio } = setup();
		const metal = solveMesh(1);
		scene.add(metal);
		const material = metal.material as THREE.MeshPhysicalMaterial;

		applyMaterialOverride(material, LOOK_PRESETS.arctic.materialOverride);
		applyReflectionEnvironment(scene, scene);
		expect(material.envMap).toBeNull();

		applyMaterialOverride(material, undefined);
		applyReflectionEnvironment(scene, scene);
		expect(material.envMap).toBe(studio);
	});

	it("leaves a host's own envMap alone", () => {
		const { scene } = setup();
		const metal = solveMesh(1);
		const own = new THREE.Texture();
		(metal.material as THREE.MeshPhysicalMaterial).envMap = own;
		scene.add(metal);
		applyReflectionEnvironment(scene, scene);
		expect((metal.material as THREE.MeshPhysicalMaterial).envMap).toBe(own);
	});

	it('survives disposing a material that uses it', () => {
		const { studio } = setup();
		let disposed = false;
		studio.addEventListener('dispose', () => (disposed = true));
		disposeMaterial(new THREE.MeshPhysicalMaterial({ envMap: studio }));
		expect(disposed).toBe(false);
	});
});
