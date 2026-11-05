import * as THREE from 'three';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';

// Synthetic, so wood work has a fixed scene without a recording: the plugin's Walnut preset and the
// variants a designer would try, each as a tabletop, a board on edge, an end-grain block and a turned
// leg. Modelled in millimetres, with the plugin's wood UVs (partUvs below).
const MM = 0.001;

const WOODS = [
	[
		'walnut-preset',
		{
			color: '#6b472e',
			metalness: 0,
			roughness: 0.5,
			finish: 'wood',
			clearcoat: 0.35,
			clearcoatRoughness: 0.3
		}
	],
	['walnut-oiled', { color: '#6b472e', metalness: 0, roughness: 0.7, finish: 'wood' }],
	['oak-oiled', { color: '#b8915e', metalness: 0, roughness: 0.7, finish: 'oak' }],
	[
		'maple-lacquered',
		{
			color: '#dcc29a',
			metalness: 0,
			roughness: 0.5,
			finish: 'maple',
			clearcoat: 0.6,
			clearcoatRoughness: 0.15
		}
	],
	['wenge-oiled', { color: '#3a2a20', metalness: 0, roughness: 0.65, finish: 'wenge' }]
];
const FLOOR = { color: '#9a9a9a', metalness: 0, roughness: 0.85 };

// GrainUvs.cs: U along the part's grain, V across the face unrolled over the surface (walking the
// mesh's edges), and on a face cut across the grain U along the part's widest direction. The plugin
// finds the widest direction by eigen-decomposition; these parts are axis-aligned, so the wider
// bounding-box side stands in.
const EDGE_ON_SINE = 0.1;

function partUvs(geometry, grain) {
	geometry.computeBoundingBox();
	const box = geometry.boundingBox;
	const centre = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const wide = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
		.filter((axis) => Math.abs(axis.dot(grain)) < 0.5)
		.sort((a, b) => size.dot(b) - size.dot(a))[0];

	const position = geometry.attributes.position;
	const normal = geometry.attributes.normal;
	const count = position.count;
	const points = [];
	const acrosses = [];
	const u = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const point = new THREE.Vector3().fromBufferAttribute(position, i).sub(centre);
		const n = new THREE.Vector3().fromBufferAttribute(normal, i).normalize();
		const along = grain.clone().addScaledVector(n, -grain.dot(n));
		if (along.length() < EDGE_ON_SINE) along.copy(wide).addScaledVector(n, -wide.dot(n));
		along.normalize();
		points.push(point);
		acrosses.push(new THREE.Vector3().crossVectors(n, along).normalize());
		u[i] = point.dot(along);
	}

	// GrainUvMath.UnrolledAcross.
	const neighbours = Array.from({ length: count }, () => []);
	const index = geometry.index.array;
	for (let t = 0; t < index.length; t += 3) {
		const [a, b, c] = [index[t], index[t + 1], index[t + 2]];
		neighbours[a].push(b, c);
		neighbours[b].push(a, c);
		neighbours[c].push(a, b);
	}
	const v = new Float64Array(count);
	const done = new Uint8Array(count);
	for (let seed = 0; seed < count; seed++) {
		if (done[seed]) continue;
		v[seed] = points[seed].dot(acrosses[seed]);
		done[seed] = 1;
		const queue = [seed];
		while (queue.length) {
			const i = queue.shift();
			for (const j of neighbours[i]) {
				if (done[j]) continue;
				const direction = acrosses[i].clone().add(acrosses[j]);
				if (direction.length() > 1e-9) direction.normalize();
				else direction.copy(acrosses[j]);
				v[j] = v[i] + points[j].clone().sub(points[i]).dot(direction);
				done[j] = 1;
				queue.push(j);
			}
		}
	}

	const uv = new Float32Array(count * 2);
	for (let i = 0; i < count; i++) {
		uv[i * 2] = u[i];
		uv[i * 2 + 1] = v[i];
	}
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	return geometry;
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);

export function buildWoodScene() {
	const meshes = [];
	const add = (name, wire, geometry, closed = true) => {
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

	const pitch = 1000;
	const x0 = (-(WOODS.length - 1) * pitch) / 2;
	add(
		'floor',
		FLOOR,
		partUvs(new THREE.BoxGeometry(WOODS.length * pitch + 400, 2200, 20), X).translate(0, 0, -10)
	);

	WOODS.forEach(([name, wire], i) => {
		const x = x0 + i * pitch;
		// A 900 x 500 x 30 tabletop, grain along its length.
		add(`${name}-top`, wire, partUvs(new THREE.BoxGeometry(900, 500, 30), X).translate(x, 450, 15));
		// A 900 x 200 x 25 board standing on edge, grain along its length.
		add(
			`${name}-board`,
			wire,
			partUvs(new THREE.BoxGeometry(900, 25, 200), X).translate(x, 100, 100)
		);
		// A 150 mm end-grain block: grain vertical, so the top face is cut across it.
		add(
			`${name}-endgrain`,
			wire,
			partUvs(new THREE.BoxGeometry(150, 150, 150), Z).translate(x - 250, -250, 75)
		);
		// A turned leg, grain along its axis.
		add(
			`${name}-leg`,
			wire,
			partUvs(new THREE.CylinderGeometry(30, 30, 600, 48).rotateX(Math.PI / 2), Z).translate(
				x + 150,
				-250,
				300
			)
		);
		// A bent plywood panel: a quarter cylinder, grain along its bend axis.
		const bent = new THREE.CylinderGeometry(200, 200, 400, 48, 1, true, 0, Math.PI / 2);
		add(
			`${name}-bent`,
			wire,
			partUvs(bent.rotateX(Math.PI / 2), Z).translate(x + 250, -700, 200),
			false
		);
	});

	return meshes;
}
