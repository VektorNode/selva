import * as THREE from 'three';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';

// Synthetic, so metal work has a fixed scene without a recording: each metal preset of the plugin
// on a sheet panel, a tube and a ball, in a row. Modelled in millimetres with UVs in mm, like a
// Part-mapped solve, so finishes and grain draw at real size.
const MM = 0.001;

// sRGB hex of a linear colour, as the plugin's `Linear(...)` presets send it.
const linear = (r, g, b) =>
	`#${new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHexString()}`;

// The plugin's metal presets (MaterialPresets.cs), as they arrive on the wire.
const METALS = [
	[
		'stainless',
		{
			color: linear(0.669, 0.639, 0.598),
			metalness: 1,
			roughness: 0.3,
			anisotropy: 0.8,
			finish: 'brushed'
		}
	],
	[
		'aluminium',
		{
			color: linear(0.916, 0.923, 0.924),
			metalness: 1,
			roughness: 0.35,
			anisotropy: 0.3,
			finish: 'rolled'
		}
	],
	['galvanised', { color: linear(0.808, 0.844, 0.865), metalness: 1, roughness: 0.4 }],
	[
		'zinc',
		{
			color: linear(0.44, 0.46, 0.47),
			metalness: 0.6,
			roughness: 0.55,
			anisotropy: 0.2,
			finish: 'rolled'
		}
	],
	[
		'copper',
		{
			color: linear(0.932, 0.623, 0.522),
			metalness: 1,
			roughness: 0.3,
			anisotropy: 0.3,
			finish: 'rolled'
		}
	],
	[
		'brass',
		{
			color: linear(0.913, 0.776, 0.423),
			metalness: 1,
			roughness: 0.35,
			anisotropy: 0.3,
			finish: 'rolled'
		}
	],
	[
		'titanium',
		{
			color: linear(0.539, 0.497, 0.451),
			metalness: 1,
			roughness: 0.4,
			anisotropy: 0.3,
			finish: 'rolled'
		}
	],
	[
		'coil-ral7016',
		{ color: '#383e42', metalness: 0, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3 }
	]
];
const CONCRETE = { color: '#828282', metalness: 0, roughness: 0.85 };

// three's UVs run 0-1 across each face; stretched to the shape's size they read as mm.
const uvsInMm = (geometry, u, v) => {
	const uv = geometry.attributes.uv;
	for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * u, uv.getY(i) * v);
	return geometry;
};

export function buildMetalScene() {
	const meshes = [];
	const add = (name, wire, geometry, closed) => {
		const material = createMaterial(
			{ opacity: 1, transparent: false, ...wire },
			{ closed, hasUvs: true }
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

	const pitch = 900;
	const x0 = (-(METALS.length - 1) * pitch) / 2;
	add(
		'slab',
		CONCRETE,
		new THREE.BoxGeometry(METALS.length * pitch + 600, 2800, 100).translate(0, 0, -50),
		true
	);

	METALS.forEach(([name, wire], i) => {
		const x = x0 + i * pitch;
		// A 3 mm sheet stood on edge, Z-up: width along x, height along z.
		const panel = uvsInMm(new THREE.BoxGeometry(600, 3, 1400), 600, 1400).translate(x, 400, 700);
		add(`${name}-panel`, wire, panel, true);

		const tube = uvsInMm(new THREE.CylinderGeometry(60, 60, 900, 48), Math.PI * 120, 900)
			.rotateX(Math.PI / 2)
			.translate(x - 150, -300, 450);
		add(`${name}-tube`, wire, tube, true);

		const ball = uvsInMm(
			new THREE.SphereGeometry(160, 64, 32),
			Math.PI * 320,
			Math.PI * 160
		).translate(x + 150, -400, 160);
		add(`${name}-ball`, wire, ball, true);

		// Lying flat, as sheet usually sits in a top view.
		const sheet = uvsInMm(new THREE.BoxGeometry(600, 500, 3), 600, 500).translate(x, -900, 1.5);
		add(`${name}-sheet`, wire, sheet, true);
	});

	return meshes;
}
