import * as THREE from 'three';

import { createMaterial } from '../src/parse/webdisplay/batch/materials.ts';
import { GLASS, TINTED_GLASS } from './glass-scene.js';
import { METALS } from './metal-scene.js';
import { PLASTICS } from './plastic-scene.js';
import { STONES } from './stone-scene.js';
import { WOODS } from './wood-scene.js';

// One fixed rig for judging materials at night: a pendant lamp over a floor in front of a wall, and
// a category's presets on an arc around the lamp's axis. On the arc every sample is the same
// distance from the bulb, so differences between them are the material, not where it stands.
// Three grey-card balls ride along in every category, so a change that only moves exposure shows
// up on them and can be told apart from one that changes a material. Millimetres, Z-up.
const MM = 0.001;

export const NIGHT_CATEGORIES = {
	metals: METALS,
	plastics: PLASTICS,
	wood: WOODS,
	stone: STONES,
	glass: [
		['glass', GLASS],
		['tinted-glass', TINTED_GLASS]
	]
};

// 18% grey is #777777 in sRGB: what an exposure meter assumes the world averages to.
const REFERENCES = [
	['ref-white', { color: '#f2f2f2', metalness: 0, roughness: 0.5 }],
	['ref-grey', { color: '#777777', metalness: 0, roughness: 0.5 }],
	['ref-black', { color: '#1a1a1a', metalness: 0, roughness: 0.5 }]
];

const RIG = {
	floor: { color: '#9a9a9a', metalness: 0, roughness: 0.85 },
	wall: { color: '#d8d6d2', metalness: 0, roughness: 0.9 },
	shade: { color: '#f2f2f2', metalness: 0, roughness: 0.5 },
	cord: { color: '#1a1a1a', metalness: 0, roughness: 0.6 },
	// Warm, like a 2700 K bulb. No `emissiveLight`, so the viewer sizes the light to the scene.
	bulb: {
		color: '#fff3dc',
		metalness: 0,
		roughness: 0.5,
		emissive: '#ffcf8a',
		emissiveIntensity: 6
	}
};

/** Height of the shade's lip above the floor. */
const SHADE_LIP = 900;
const BALL_RADIUS = 60;
const BALL_ARC = 650;
const TILE_ARC = 830;
const TILE = 140;
/** The arc spans the front of the lamp, the side the camera fits from. */
const ARC_FROM = THREE.MathUtils.degToRad(195);
const ARC_TO = THREE.MathUtils.degToRad(345);

// World mapping in mm: each face projected along its dominant normal axis, so finishes and grain
// draw at real size on any shape.
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

// A closed shell with a wall thickness, so the shade reads as a shade from any angle and blocks
// the bulb from above. Lathe profile in (radius, height), from the top centre down to the lip.
function shadeGeometry() {
	const profile = [
		[0, 150],
		[50, 150],
		[210, 0],
		[204, 0],
		[46, 144],
		[0, 144]
	].map(([r, h]) => new THREE.Vector2(r, h));
	return new THREE.LatheGeometry(profile, 96).rotateX(Math.PI / 2).translate(0, 0, SHADE_LIP);
}

export function buildNightScene(category) {
	const presets = NIGHT_CATEGORIES[category];
	if (!presets) {
		throw new Error(
			`No night category ${category}: use ${Object.keys(NIGHT_CATEGORIES).join(', ')}.`
		);
	}

	const meshes = [];
	const add = (name, wire, geometry) => {
		const material = createMaterial(
			{ opacity: 1, transparent: false, ...wire },
			{ closed: true, hasUvs: true }
		);
		const mesh = new THREE.Mesh(worldUvs(geometry), material);
		mesh.name = name;
		mesh.userData = { source: 'compute', name, layer: '', trackingKey: name, metadata: {} };
		mesh.castShadow = material.userData.selvaGlass !== true;
		mesh.receiveShadow = true;
		mesh.scale.setScalar(MM);
		mesh.updateMatrixWorld();
		meshes.push(mesh);
	};

	add('floor', RIG.floor, new THREE.BoxGeometry(2400, 1800, 20).translate(0, -100, -10));
	add('wall', RIG.wall, new THREE.BoxGeometry(2400, 20, 1800).translate(0, 810, 900));
	add('shade', RIG.shade, shadeGeometry());
	add(
		'cord',
		RIG.cord,
		new THREE.CylinderGeometry(3, 3, 700, 8)
			.rotateX(Math.PI / 2)
			.translate(0, 0, SHADE_LIP + 150 + 350)
	);
	add('bulb', RIG.bulb, new THREE.SphereGeometry(35, 32, 16).translate(0, 0, SHADE_LIP + 50));

	const samples = [...presets, ...REFERENCES];
	samples.forEach(([name, wire], i) => {
		const angle = ARC_FROM + ((ARC_TO - ARC_FROM) * i) / (samples.length - 1);
		const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
		add(
			`${name}-ball`,
			wire,
			new THREE.SphereGeometry(BALL_RADIUS, 64, 32).translate(
				cos * BALL_ARC,
				sin * BALL_ARC,
				BALL_RADIUS
			)
		);
		// References only need the ball: a grey card is read off one shape.
		if (name.startsWith('ref-')) return;
		add(
			`${name}-tile`,
			wire,
			new THREE.BoxGeometry(TILE, TILE, 10)
				.rotateZ(angle)
				.translate(cos * TILE_ARC, sin * TILE_ARC, 5)
		);
	});

	return meshes;
}
