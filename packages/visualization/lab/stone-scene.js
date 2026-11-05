import * as THREE from 'three';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';

// Synthetic, so stone work has a fixed scene without a recording: each stone and paving preset of
// the plugin as a floor, a wall and a step. Modelled in millimetres with World-mapped UVs in mm.
const MM = 0.001;

// The plugin's stone presets (MaterialPresets.cs) as they arrive on the wire.
export const STONES = [
	['limestone', { color: '#c9b697', metalness: 0, roughness: 0.65, finish: 'limestone' }],
	['travertine', { color: '#d9cdb6', metalness: 0, roughness: 0.6, finish: 'travertine' }],
	['granite', { color: '#9a9998', metalness: 0, roughness: 0.85, finish: 'granite' }],
	['marble', { color: '#e6e7e8', metalness: 0, roughness: 0.12, finish: 'marble' }],
	['slate', { color: '#3f454c', metalness: 0, roughness: 0.65, finish: 'slate' }],
	['terrazzo', { color: '#d9d5cc', metalness: 0, roughness: 0.3, finish: 'terrazzo' }],
	['paving', { color: '#9a9893', metalness: 0, roughness: 0.9, finish: 'paving' }],
	['setts', { color: '#8e8c88', metalness: 0, roughness: 0.75, finish: 'setts' }],
	['gravel', { color: '#bfae98', metalness: 0, roughness: 0.9, finish: 'gravel' }]
];
const FLOOR = { color: '#9a9a9a', metalness: 0, roughness: 0.85 };

// World mapping: each face projected along its dominant normal axis, in mm.
const worldUvs = (geometry) => {
	const position = geometry.attributes.position;
	const normal = geometry.attributes.normal;
	const uv = new Float32Array(position.count * 2);
	for (let i = 0; i < position.count; i++) {
		const [x, y, z] = [position.getX(i), position.getY(i), position.getZ(i)];
		const [nx, ny, nz] = [normal.getX(i), normal.getY(i), normal.getZ(i)].map(Math.abs);
		const [u, v] = nz >= nx && nz >= ny ? [x, y] : nx >= ny ? [y, z] : [x, z];
		uv[i * 2] = u;
		uv[i * 2 + 1] = v;
	}
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return geometry;
};

const box = (w, d, h, x, y, z) =>
	worldUvs(new THREE.BoxGeometry(w, d, h).translate(x, y, z + h / 2));

export function buildStoneScene() {
	const meshes = [];
	const add = (name, wire, geometry) => {
		const material = createMaterial(
			{ opacity: 1, transparent: false, ...wire },
			{ closed: true, hasUvs: true }
		);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = name;
		mesh.userData = { source: 'compute', name, layer: '', trackingKey: name, metadata: {} };
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		mesh.scale.setScalar(MM);
		mesh.updateMatrixWorld();
		meshes.push(mesh);
	};

	const pitch = 1400;
	const x0 = (-(STONES.length - 1) * pitch) / 2;
	add('floor', FLOOR, box(STONES.length * pitch + 400, 2400, 20, 0, 0, -20));

	STONES.forEach(([name, wire], i) => {
		const x = x0 + i * pitch;
		add(`${name}-floor`, wire, box(1200, 1400, 30, x, -200, 0));
		add(`${name}-wall`, wire, box(1200, 200, 1400, x, 700, 0));
		add(`${name}-step`, wire, box(500, 350, 160, x - 250, 200, 30));
	});

	return meshes;
}
