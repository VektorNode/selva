import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LOOK_PRESETS, type Look } from '../../../shared/index.js';
import { applyMaterialOverride } from '../appearance.js';

// Switching between two looks that both override used to leave behind whatever the first set and
// the second was silent about: `wireframe` out of the wireframe look, `opacity`/`depthWrite` out of
// xray. Only these four looks override at all, so every pair among them is a candidate leak.
const OVERRIDING: Look[] = ['arctic', 'xray', 'lineart', 'wireframe'];

/** A wall as the parser builds one: white, matte, opaque, solid. */
const wall = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8 });

const setLook = (material: THREE.Material, look: Look) =>
	applyMaterialOverride(material, LOOK_PRESETS[look].materialOverride);

describe('look material overrides do not leak into the next look', () => {
	it('drops wireframe when leaving the wireframe look', () => {
		const material = wall();

		setLook(material, 'wireframe');
		expect(material.wireframe).toBe(true);

		setLook(material, 'arctic');
		expect(material.wireframe).toBe(false);
	});

	it('drops transparency when leaving xray', () => {
		const material = wall();

		setLook(material, 'xray');
		expect(material.opacity).toBeLessThan(1);
		expect(material.depthWrite).toBe(false);

		setLook(material, 'lineart');
		expect(material.opacity).toBe(1);
		expect(material.depthWrite).toBe(true);
	});

	it.each(OVERRIDING)('restores the parsed material when leaving %s for a plain look', (look) => {
		const material = wall();
		const parsed = {
			color: material.color.getHex(),
			opacity: material.opacity,
			depthWrite: material.depthWrite,
			wireframe: material.wireframe
		};

		setLook(material, look);
		setLook(material, 'technical'); // no materialOverride

		expect(material.color.getHex()).toBe(parsed.color);
		expect(material.opacity).toBe(parsed.opacity);
		expect(material.depthWrite).toBe(parsed.depthWrite);
		expect(material.wireframe).toBe(parsed.wireframe);
	});

	// Every ordered pair, so a future look that overrides a new field can't quietly reintroduce this.
	it.each(
		OVERRIDING.flatMap((from) => OVERRIDING.filter((to) => to !== from).map((to) => [from, to]))
	)('%s → %s leaves only what the second look asks for', (from, to) => {
		const direct = wall();
		setLook(direct, to as Look);

		const viaOther = wall();
		setLook(viaOther, from as Look);
		setLook(viaOther, to as Look);

		expect(viaOther.wireframe).toBe(direct.wireframe);
		expect(viaOther.opacity).toBe(direct.opacity);
		expect(viaOther.transparent).toBe(direct.transparent);
		expect(viaOther.depthWrite).toBe(direct.depthWrite);
		expect(viaOther.color.getHex()).toBe(direct.color.getHex());
		expect(viaOther.roughness).toBe(direct.roughness);
		expect(viaOther.metalness).toBe(direct.metalness);
	});
});
