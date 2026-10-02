import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { SOURCE_COMPUTE } from '../scene-ownership.js';

// A metal shows nothing but its reflection. The HDR that lights the scene is an outdoor sky with a
// hard horizon over a near-black ground, so a metal mirrors a white band over a black one and the
// split lands mid-face, jagged wherever roughness varies. Metals reflect a soft studio room instead;
// everything else keeps the HDR, so the looks tuned on it don't move.
const METAL = 0.5;

const KEY = 'selvaReflectionEnvironment';

interface ReflectionEnvironment {
	texture: THREE.Texture;
	rotation: THREE.Euler;
}

/**
 * Builds the studio probe once per scene. `rotation` turns its Y-up room to the scene's up, the same
 * rotation the HDR gets.
 */
export function createReflectionEnvironment(
	scene: THREE.Scene,
	renderer: THREE.WebGLRenderer,
	rotation: THREE.Euler
): void {
	const pmrem = new THREE.PMREMGenerator(renderer);
	const room = new RoomEnvironment();
	const texture = pmrem.fromScene(room, 0.04).texture;
	room.dispose();
	pmrem.dispose();
	installReflectionEnvironment(scene, texture, rotation);
}

/** The GPU-free half of {@link createReflectionEnvironment}; tests call it with a plain texture. */
export function installReflectionEnvironment(
	scene: THREE.Scene,
	texture: THREE.Texture,
	rotation: THREE.Euler
): void {
	const environment: ReflectionEnvironment = { texture, rotation: rotation.clone() };
	scene.userData[KEY] = environment;
	applyReflectionEnvironment(scene, scene);
}

export function disposeReflectionEnvironment(scene: THREE.Scene): void {
	(scene.userData[KEY] as ReflectionEnvironment | undefined)?.texture.dispose();
	delete scene.userData[KEY];
}

/**
 * Points every metallic solve material under `root` at the studio probe, and every other one back
 * at `scene.environment`. Run after meshes are added and after a look changes metalness.
 *
 * A material's own `envMap` also makes three honour its `envMapIntensity`: with only
 * `scene.environment`, three overwrites it with `scene.environmentIntensity` on every draw.
 */
export function applyReflectionEnvironment(root: THREE.Object3D, scene: THREE.Scene): void {
	const environment = scene.userData[KEY] as ReflectionEnvironment | undefined;
	if (!environment) return;
	root.traverse((object) => {
		if (object.userData.source !== SOURCE_COMPUTE) return;
		const mesh = object as Partial<THREE.Mesh> & THREE.Object3D;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: mesh.material
				? [mesh.material]
				: [];
		for (const material of materials) {
			if (!(material instanceof THREE.MeshStandardMaterial)) continue;
			// Leave a host's own envMap alone.
			if (material.envMap && material.envMap !== environment.texture) continue;
			const wanted = material.metalness > METAL ? environment.texture : null;
			if (material.envMap === wanted) continue;
			material.envMap = wanted;
			material.envMapRotation.copy(environment.rotation);
			material.needsUpdate = true;
		}
	});
}
