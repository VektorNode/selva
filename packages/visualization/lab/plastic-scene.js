import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';

// Synthetic, so plastic work has a fixed scene without a recording: each plastic preset of the
// plugin on a product housing, a knob and a ball. Modelled in millimetres with UVs in mm, like a
// World-mapped solve, so the molded grain draws at real size.
const MM = 0.001;

// The plugin's plastic presets (MaterialPresets.cs) as they arrive on the wire, each in a colour a
// designer would wire into Color.
const PLASTICS = [
	['glossy-red', { color: '#c0262d', metalness: 0, roughness: 0.12 }],
	['satin-white', { color: '#f2f2ee', metalness: 0, roughness: 0.38 }],
	['matte-black', { color: '#1d1e20', metalness: 0, roughness: 0.6 }],
	['textured-black', { color: '#1d1e20', metalness: 0, roughness: 0.45, finish: 'molded' }],
	['textured-grey', { color: '#c9c9c4', metalness: 0, roughness: 0.45, finish: 'molded' }],
	[
		'soft-touch-grey',
		{
			color: '#3c3f42',
			metalness: 0,
			roughness: 0.8,
			sheen: 1,
			sheenColor: '#8a8d90',
			sheenRoughness: 0.6
		}
	],
	['clear', { color: '#ffffff', metalness: 0, roughness: 0.05, transmission: 1, ior: 1.58 }],
	['frosted', { color: '#ffffff', metalness: 0, roughness: 0.45, transmission: 1, ior: 1.58 }]
];
const FLOOR = { color: '#9a9a9a', metalness: 0, roughness: 0.85 };

// three's UVs run 0-1 across each face; stretched to the shape's size they read as mm.
const uvsInMm = (geometry, u, v) => {
	const uv = geometry.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
	return geometry;
};

export function buildPlasticScene() {
	const meshes = [];
	const add = (name, wire, geometry) => {
		const material = createMaterial(
			{ opacity: 1, transparent: false, ...wire },
			{ closed: true, hasUvs: true }
		);
		const mesh = new THREE.Mesh(geometry, material);
		mesh.name = name;
		mesh.userData = { source: 'compute', name, layer: '', trackingKey: name, metadata: {} };
		mesh.castShadow = material.userData.selvaGlass !== true;
		mesh.receiveShadow = true;
		mesh.scale.setScalar(MM);
		mesh.updateMatrixWorld();
		meshes.push(mesh);
	};

	const pitch = 260;
	const x0 = (-(PLASTICS.length - 1) * pitch) / 2;
	add(
		'floor',
		FLOOR,
		new THREE.BoxGeometry(PLASTICS.length * pitch + 200, 700, 20).translate(0, 0, -10)
	);

	PLASTICS.forEach(([name, wire], i) => {
		const x = x0 + i * pitch;
		// A handheld housing, Z-up: built tall along z.
		const housing = uvsInMm(new RoundedBoxGeometry(150, 60, 220, 6, 18), 150, 220);
		add(`${name}-housing`, wire, housing.translate(x, 120, 110));
		const knob = uvsInMm(new THREE.CylinderGeometry(40, 44, 40, 64), Math.PI * 84, 40);
		add(`${name}-knob`, wire, knob.rotateX(Math.PI / 2).translate(x - 50, -80, 20));
		const ball = uvsInMm(new THREE.SphereGeometry(45, 64, 32), Math.PI * 90, Math.PI * 45);
		add(`${name}-ball`, wire, ball.translate(x + 55, -90, 45));
	});

	return meshes;
}
