import * as THREE from 'three';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';

// Synthetic, so glass work has a fixed scene without a recording: a double-skin glass façade in
// front of coloured blocks, and a thick tinted glass cube. Modelled in millimetres, like a solve.
const MM = 0.001;

// The plugin's Glass preset, as it arrives on the wire.
export const GLASS = {
	color: '#ffffff',
	metalness: 0,
	roughness: 0.05,
	opacity: 1,
	transparent: false,
	transmission: 1,
	ior: 1.52
};
export const TINTED_GLASS = { ...GLASS, thickness: 1000, attenuationColor: '#6fb7a4' };
const ALUMINIUM = {
	color: '#b9bec4',
	metalness: 1,
	roughness: 0.35,
	opacity: 1,
	transparent: false
};
const CONCRETE = {
	color: '#828282',
	metalness: 0,
	roughness: 0.85,
	opacity: 1,
	transparent: false
};
const paint = (color) => ({ color, metalness: 0, roughness: 0.5, opacity: 1, transparent: false });

export function buildGlassScene({ panesOnly = false } = {}) {
	const meshes = [];
	// Z-up like Rhino: size is [width along x, height along z, depth along y].
	const box = (name, material, [w, h, d], [x, y, z]) => {
		const geometry = new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2);
		const mesh = new THREE.Mesh(geometry, createMaterial(material, { closed: true }));
		mesh.name = name;
		mesh.userData = { source: 'compute', name, layer: '', trackingKey: name, metadata: {} };
		mesh.castShadow = mesh.material.userData.selvaGlass !== true;
		mesh.receiveShadow = true;
		mesh.scale.setScalar(MM);
		mesh.updateMatrixWorld();
		meshes.push(mesh);
	};

	box('slab', CONCRETE, [14000, 200, 10000], [0, 0, -200]);

	// Coloured blocks behind the façade: what the glass has to show.
	const colours = ['#c8372d', '#e0a526', '#2f6fb3', '#3d9a5b'];
	colours.forEach((colour, i) =>
		box(`block-${i}`, paint(colour), [1400, 1800 + i * 500, 1400], [-4500 + i * 3000, 2500, 0])
	);

	// Two skins 600 mm apart, each a closed 12 mm pane, as Grasshopper models them.
	for (const [skin, y] of [
		['outer', -1500],
		['inner', -900]
	]) {
		for (let i = 0; i < 4; i++) {
			box(`${skin}-pane-${i}`, GLASS, [2900, 3600, 12], [-4500 + i * 3000, y, 0]);
		}
		for (let i = 0; i < 5; i++) {
			box(`${skin}-mullion-${i}`, ALUMINIUM, [60, 3600, 120], [-6000 + i * 3000, y, 0]);
		}
	}

	// A thick glass cube on a plinth: refraction and tint, where thickness is set.
	if (panesOnly) return meshes;
	box('plinth', CONCRETE, [1200, 600, 1200], [4500, -3500, 0]);
	box('cube', TINTED_GLASS, [1000, 1000, 1000], [4500, -3500, 600]);
	box('behind-cube', paint('#e0a526'), [300, 1600, 300], [4500, -2500, 0]);

	return meshes;
}
