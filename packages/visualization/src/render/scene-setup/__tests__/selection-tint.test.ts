import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LOOK_PRESETS } from '../../../shared/index.js';
import { tintForSelection } from '../setup-events.js';

// The regression these guard: the highlight used to be emissive-only, which is additive on top of
// what the surface already reflects. When the looks gained a key light, a red emissive on a bright
// white wall stopped reading as selected at all.

const RED = new THREE.Color('#ff0000');

/** A wall as the parser builds one: white, matte, opaque. */
const wall = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.8 });

describe('tintForSelection', () => {
	it('moves a white surface most of the way to the selection color', () => {
		const material = wall();
		tintForSelection(material, RED, true);

		// Red channel holds, green/blue collapse — i.e. it actually looks red, not pink.
		expect(material.color.r).toBeCloseTo(1, 2);
		expect(material.color.g).toBeLessThan(0.3);
		expect(material.color.b).toBeLessThan(0.3);
	});

	it('tints the albedo, not just the emissive channel', () => {
		const material = wall();
		tintForSelection(material, RED, true);

		// Emissive alone was the bug: it washes out as the key light gets brighter.
		expect(material.color.equals(new THREE.Color(0xffffff))).toBe(false);
		expect(material.emissive.getHex()).toBe(0xff0000);
		expect(material.emissiveIntensity).toBeGreaterThan(0);
	});

	it('keeps emissive low enough that shading survives', () => {
		const material = wall();
		tintForSelection(material, RED, true);
		// Blown-out emissive turns the mesh into a flat silhouette with no readable form.
		expect(material.emissiveIntensity).toBeLessThanOrEqual(1);
	});

	it('knocks metalness down so a chrome surface still shows the tint', () => {
		const material = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1 });
		tintForSelection(material, RED, true);
		expect(material.metalness).toBeLessThan(0.5);
	});

	it('forces an x-ray-transparent mesh opaque so the highlight is not a ghost', () => {
		const override = LOOK_PRESETS.xray.materialOverride!;
		const material = new THREE.MeshPhysicalMaterial({
			color: 0xffffff,
			opacity: override.opacity,
			transparent: true,
			depthWrite: override.depthWrite
		});

		tintForSelection(material, RED, true);

		expect(material.opacity).toBe(1);
		expect(material.transparent).toBe(false);
		// Without this the selection sorts behind its own neighbours.
		expect(material.depthWrite).toBe(true);
	});

	it('leaves an already-opaque mesh alone', () => {
		const material = wall();
		tintForSelection(material, RED, true);
		expect(material.transparent).toBe(false);
		expect(material.opacity).toBe(1);
	});

	it('recolors lines outright — they have no emissive channel', () => {
		const material = new THREE.LineBasicMaterial({ color: 0x333333 });
		tintForSelection(material, RED, false);
		expect(material.color.getHex()).toBe(0xff0000);
	});

	it('honours a non-red selection color', () => {
		const material = wall();
		const blue = new THREE.Color('#0000ff');
		tintForSelection(material, blue, true);
		expect(material.emissive.getHex()).toBe(0x0000ff);
		expect(material.color.b).toBeGreaterThan(material.color.r);
	});
});
