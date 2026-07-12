import * as THREE from 'three';

export const EMISSIVE_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: 0x000000,
	emissive: new THREE.Color(0xffffff),
	emissiveIntensity: 5,
	metalness: 0.0,
	roughness: 0.2,
	clearcoat: 0.3,
	clearcoatRoughness: 0.2,
	depthWrite: true,
	depthTest: true,
	transparent: false,
	alphaTest: 0.0,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
	side: THREE.FrontSide,
	dithering: true
});

export const METAL_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0x000000),
	metalness: 0.9,
	roughness: 0.3,
	envMapIntensity: 1.2,
	clearcoat: 0.3,
	clearcoatRoughness: 0.2,
	reflectivity: 1,
	ior: 2.5,
	thickness: 1,
	depthWrite: true,
	transparent: false,
	alphaTest: 0.0,
	depthTest: true,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
	side: THREE.FrontSide,
	dithering: true
});

export const CONCRETE_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0xcccccc),
	metalness: 0.0,
	roughness: 0.92,
	envMapIntensity: 0.15,
	clearcoat: 0.05,
	clearcoatRoughness: 0.9,
	reflectivity: 0.15,
	transmission: 0.0,
	ior: 1.45,
	thickness: 0.0,
	depthWrite: true,
	transparent: false,
	// No alphaTest: concrete has no alpha map, and a nonzero alphaTest needlessly switches the
	// shader onto the alpha-test path.
	alphaTest: 0.0,
	depthTest: true,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1,
	side: THREE.FrontSide,
	dithering: true
});

export const PLASTIC_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0xffffff), // Default white plastic
	metalness: 0.0,
	roughness: 0.3,
	envMapIntensity: 0.5,
	clearcoat: 0.5,
	clearcoatRoughness: 0.1,
	reflectivity: 0.5,
	ior: 1.4,
	transmission: 0.0,
	transparent: false,
	depthWrite: true,
	side: THREE.FrontSide,
	dithering: true,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1
});

export const GLASS_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0xffffff),
	metalness: 0.0,
	roughness: 0.0,
	// Transmission alone models the see-through look; stacking a low `opacity` on top would
	// attenuate twice and render glass much darker than intended (opacity stays at its default 1).
	transmission: 0.95,
	transparent: true,
	// A depth-writing transparent DoubleSide surface culls whatever sorts behind it — objects
	// behind glass would intermittently vanish depending on draw order.
	depthWrite: false,
	envMapIntensity: 1.0,
	clearcoat: 1.0,
	clearcoatRoughness: 0.0,
	ior: 1.52,
	reflectivity: 0.9,
	thickness: 1.0,
	side: THREE.DoubleSide,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1
});

export const RUBBER_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0x1a1a1a),
	metalness: 0.0,
	roughness: 0.9,
	envMapIntensity: 0.2,
	clearcoat: 0.1,
	clearcoatRoughness: 0.8,
	reflectivity: 0.2,
	ior: 1.3,
	transmission: 0.0,
	depthWrite: true,
	side: THREE.FrontSide,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1
});

export const WOOD_MATERIAL = new THREE.MeshPhysicalMaterial({
	color: new THREE.Color(0x885533),
	metalness: 0.0,
	roughness: 0.7,
	envMapIntensity: 0.3,
	clearcoat: 0.3,
	clearcoatRoughness: 0.4,
	reflectivity: 0.3,
	ior: 1.3,
	transmission: 0.0,
	depthWrite: true,
	side: THREE.FrontSide,
	dithering: true,
	polygonOffset: true,
	polygonOffsetFactor: 1,
	polygonOffsetUnits: 1
});

/**
 * The module-scope singleton materials above, as a set. Scene-clearing code must NOT dispose a
 * material in this set: they are shared across meshes and across solves, and `dispose()` on a
 * still-referenced material forces a shader program rebuild on its next use (and would free any
 * textures they gain later while other objects still use them).
 */
export const SHARED_MATERIALS: ReadonlySet<THREE.Material> = new Set<THREE.Material>([
	EMISSIVE_MATERIAL,
	METAL_MATERIAL,
	CONCRETE_MATERIAL,
	PLASTIC_MATERIAL,
	GLASS_MATERIAL,
	RUBBER_MATERIAL,
	WOOD_MATERIAL
]);
