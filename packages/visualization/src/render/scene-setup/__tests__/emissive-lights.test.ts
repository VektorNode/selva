import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
	EMISSIVE_LIGHT,
	OWN_EMISSIVE,
	cloneForTint,
	setHiddenMembers
} from '../../../shared/index.js';
import { SOURCE_COMPUTE } from '../../scene-ownership.js';
import { createEmissiveLights, pickLightSources } from '../emissive-lights.js';

const source = (strength: number) => ({
	bounds: new THREE.Box3(),
	color: new THREE.Color(0xffffff),
	strength
});

function glowingBox(strength: number, at: [number, number, number]) {
	const material = new THREE.MeshStandardMaterial({
		emissive: 0xffeecc,
		emissiveIntensity: strength
	});
	material.userData[OWN_EMISSIVE] = true;
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
	mesh.position.set(...at);
	mesh.userData.source = SOURCE_COMPUTE;
	mesh.castShadow = true;
	mesh.updateMatrixWorld();
	return mesh;
}

const allPointLights = (scene: THREE.Scene) =>
	scene.children.filter((c): c is THREE.PointLight => (c as THREE.PointLight).isPointLight);

/** Two unit triangles a long way apart in one merged mesh, the way the parser merges by material. */
function mergedLamps() {
	const lamp = glowingBox(4, [0, 0, 0]);
	const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0, 100, 0, 0, 101, 0, 0, 100, 1, 0];
	lamp.geometry = new THREE.BufferGeometry() as THREE.BoxGeometry;
	lamp.geometry
		.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
		.setIndex([0, 1, 2, 3, 4, 5]);
	lamp.userData.members = [
		{ name: 'a', layer: '', metadata: {}, indexStart: 0, indexCount: 3 },
		{ name: 'b', layer: '', metadata: {}, indexStart: 3, indexCount: 3 }
	];
	return lamp;
}

/** The bounce light sits beside each one and casts nothing. */
const pointLights = (scene: THREE.Scene) => allPointLights(scene).filter((l) => l.castShadow);

describe('pickLightSources', () => {
	it('leaves out a faint glow beside a strong one: a diffuser is not a second bulb', () => {
		expect(pickLightSources([source(6), source(1)]).map((s) => s.strength)).toEqual([6]);
	});

	it('keeps comparable sources, strongest first, up to the cap', () => {
		const picked = pickLightSources([source(3), source(4), source(5), source(4.5)]);
		expect(picked.map((s) => s.strength)).toEqual([5, 4.5, 4]);
	});

	it('returns nothing when nothing glows', () => {
		expect(pickLightSources([])).toEqual([]);
	});
});

describe('createEmissiveLights', () => {
	it('puts a light at the glowing mesh and stops it shadowing its own light', () => {
		const scene = new THREE.Scene();
		const bulb = glowingBox(4, [2, 0, 3]);
		scene.add(bulb);

		createEmissiveLights(scene).sync(true);

		const [light] = pointLights(scene);
		expect(light.position.toArray()).toEqual([2, 0, 3]);
		expect(light.castShadow).toBe(true);
		expect(bulb.castShadow).toBe(false);
	});

	it('lights a glow without lumens like the lamp its strength stands for', () => {
		const light = (lumens?: number) => {
			const scene = new THREE.Scene();
			const lamp = glowingBox(5, [0, 0, 0]);
			if (lumens !== undefined) {
				(lamp.material as THREE.Material).userData[EMISSIVE_LIGHT] =
					(lumens / (4 * Math.PI)) * 0.005;
			}
			// A room around it, or a glow the size of the whole scene gets no point light at all.
			const room = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
			room.position.set(60, 0, 0);
			room.userData.source = SOURCE_COMPUTE;
			room.updateMatrixWorld();
			scene.add(lamp, room);
			createEmissiveLights(scene).sync(true);
			return pointLights(scene)[0].intensity;
		};
		// Strength 5 is what the plugin sends for 800 lm.
		expect(light()).toBeCloseTo(light(800));
	});

	it('scales every light it casts by the look', () => {
		const scene = new THREE.Scene();
		const lamp = glowingBox(5, [0, 0, 0]);
		(lamp.material as THREE.Material).userData[EMISSIVE_LIGHT] = 2;
		scene.add(lamp);

		createEmissiveLights(scene).sync(true, undefined, 3);

		expect(pointLights(scene)[0].intensity).toBe(6);
	});

	it("uses a real source's intensity as given, so lumens mean the same at any model size", () => {
		const scene = new THREE.Scene();
		const lamp = glowingBox(5, [0, 0, 0]);
		(lamp.material as THREE.Material).userData[EMISSIVE_LIGHT] = 1234;
		scene.add(lamp);

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)[0].intensity).toBe(1234);
	});

	it('adds a faint unshadowed bounce beside each source', () => {
		const scene = new THREE.Scene();
		const backdrop = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
		backdrop.position.set(60, 0, 3);
		backdrop.userData.source = SOURCE_COMPUTE;
		backdrop.updateMatrixWorld();
		scene.add(glowingBox(4, [2, 0, 3]), backdrop);

		createEmissiveLights(scene).sync(true);

		const bounce = allPointLights(scene).find((l) => !l.castShadow)!;
		expect(bounce.position.toArray()).toEqual([2, 0, 3]);
		expect(bounce.intensity).toBeLessThan(pointLights(scene)[0].intensity * 0.2);
	});

	it('leaves a glow as wide as the scene to its bounce: a point there burns a hole', () => {
		const scene = new THREE.Scene();
		scene.add(glowingBox(4, [2, 0, 3]));

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)[0].intensity).toBe(0);
		expect(allPointLights(scene).find((l) => !l.castShadow)!.intensity).toBeGreaterThan(0);
	});

	it('removes its lights and restores shadows when the look no longer wants them', () => {
		const scene = new THREE.Scene();
		const bulb = glowingBox(4, [0, 0, 0]);
		scene.add(bulb);
		const lights = createEmissiveLights(scene);

		lights.sync(true);
		lights.sync(false);

		expect(allPointLights(scene)).toHaveLength(0);
		expect(bulb.castShadow).toBe(true);
	});

	it('lights a selected lamp from its own glow, not the tint on the clone', () => {
		const scene = new THREE.Scene();
		const lamp = glowingBox(4, [0, 0, 0]);
		const tinted = cloneForTint(lamp.material as THREE.Material) as THREE.MeshStandardMaterial;
		tinted.emissive.set(0xff0000);
		tinted.emissiveIntensity = 0.6;
		lamp.material = tinted;
		scene.add(lamp);

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)[0].color.getHex()).toBe(new THREE.Color(0xffeecc).getHex());
	});

	it('gives no light to a lamp under a hidden group', () => {
		const scene = new THREE.Scene();
		const group = new THREE.Group();
		group.add(glowingBox(4, [0, 0, 0]));
		group.visible = false;
		scene.add(group);

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)).toHaveLength(0);
	});

	it('leaves a faint glow casting shadows, unless it wraps a light', () => {
		const scene = new THREE.Scene();
		const bulb = glowingBox(4, [0, 0, 0]);
		const diffuser = glowingBox(1, [0, 0, 0]);
		const facade = glowingBox(1, [20, 0, 0]);
		diffuser.scale.setScalar(3);
		diffuser.updateMatrixWorld();
		scene.add(bulb, diffuser, facade);

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)).toHaveLength(1);
		expect(diffuser.castShadow).toBe(false);
		expect(facade.castShadow).toBe(true);
	});

	it('treats touching parts of one glow as one lamp, whatever their material instance', () => {
		const scene = new THREE.Scene();
		scene.add(glowingBox(4, [0, 0, 0]), glowingBox(4, [1, 0, 0]));

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)).toHaveLength(1);
		expect(pointLights(scene)[0].position.x).toBeCloseTo(0.5);
	});

	it('gives a light to each of two lamps sharing a material', () => {
		const scene = new THREE.Scene();
		const left = glowingBox(4, [-10, 0, 0]);
		const right = glowingBox(4, [10, 0, 0]);
		right.material = left.material;
		scene.add(left, right);

		createEmissiveLights(scene).sync(true);

		const xs = pointLights(scene).map((light) => light.position.x);
		expect(xs.sort((a, b) => a - b)).toEqual([-10, 10]);
	});

	it('puts one light in the middle of more lamps than it has lights', () => {
		const scene = new THREE.Scene();
		for (const x of [0, 10, 20, 30]) scene.add(glowingBox(4, [x, 0, 0]));

		createEmissiveLights(scene).sync(true);

		expect(pointLights(scene)).toHaveLength(1);
		expect(pointLights(scene)[0].position.x).toBeCloseTo(15);
	});

	it('lights each member of a merged mesh, and drops a hidden one on the next sync', () => {
		const scene = new THREE.Scene();
		const lamps = mergedLamps();
		scene.add(lamps);
		const lights = createEmissiveLights(scene);

		lights.sync(true);
		expect(pointLights(scene)).toHaveLength(2);

		setHiddenMembers(lamps, new Set([1]));
		lights.sync(true);
		expect(pointLights(scene)).toHaveLength(1);
		expect(pointLights(scene)[0].position.x).toBeCloseTo(0.5);
	});

	it('draws shadow maps once per sync and keeps its lights across syncs', () => {
		const scene = new THREE.Scene();
		scene.add(glowingBox(4, [0, 0, 0]));
		const lights = createEmissiveLights(scene);

		lights.sync(true);
		const [light] = pointLights(scene);
		expect(light.shadow.autoUpdate).toBe(false);
		expect(light.shadow.needsUpdate).toBe(true);

		light.shadow.needsUpdate = false;
		lights.sync(true);
		expect(pointLights(scene)[0]).toBe(light);
		expect(light.shadow.needsUpdate).toBe(true);
	});

	it('refreshes the shadow projection when the model changes size', () => {
		const scene = new THREE.Scene();
		const lamp = glowingBox(4, [0, 0, 0]);
		scene.add(lamp);
		const lights = createEmissiveLights(scene);

		lights.sync(true);
		const { camera } = pointLights(scene)[0].shadow;
		const before = camera.projectionMatrix.clone();

		lamp.scale.setScalar(100);
		lamp.updateMatrixWorld();
		lights.sync(true);

		expect(camera.projectionMatrix.equals(before)).toBe(false);
	});

	it('keeps a bounce with the one light a phone gets, which alone lights the room', () => {
		const scene = new THREE.Scene();
		scene.add(glowingBox(4, [-10, 0, 0]), glowingBox(6, [10, 0, 0]), glowingBox(5, [30, 0, 0]));

		createEmissiveLights(scene).sync(true, 1);

		expect(pointLights(scene).map((light) => light.position.x)).toEqual([10]);
		expect(allPointLights(scene)).toHaveLength(2);
	});

	it('merges more lamps than a phone has lights, rather than picking one by mesh order', () => {
		const scene = new THREE.Scene();
		const left = glowingBox(4, [-10, 0, 0]);
		const right = glowingBox(4, [10, 0, 0]);
		right.material = left.material;
		scene.add(left, right);

		createEmissiveLights(scene).sync(true, 1);

		expect(pointLights(scene)).toHaveLength(1);
		expect(pointLights(scene)[0].position.x).toBeCloseTo(0);
	});

	it('ignores a selection tint, which uses the emissive channel too', () => {
		const scene = new THREE.Scene();
		const mesh = glowingBox(4, [0, 0, 0]);
		delete (mesh.material as THREE.Material).userData[OWN_EMISSIVE];
		scene.add(mesh);

		createEmissiveLights(scene).sync(true);

		expect(allPointLights(scene)).toHaveLength(0);
	});
});
