import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
	CONCRETE_MATERIAL,
	EMISSIVE_MATERIAL,
	GLASS_MATERIAL,
	METAL_MATERIAL,
	PLASTIC_MATERIAL,
	RUBBER_MATERIAL,
	SHARED_MATERIALS,
	WOOD_MATERIAL
} from '../three-materials';

const ALL = {
	EMISSIVE_MATERIAL,
	METAL_MATERIAL,
	CONCRETE_MATERIAL,
	PLASTIC_MATERIAL,
	GLASS_MATERIAL,
	RUBBER_MATERIAL,
	WOOD_MATERIAL
};

describe('GLASS_MATERIAL', () => {
	it('does not write depth while transparent', () => {
		// Regression: a depth-writing transparent DoubleSide surface culls whatever sorts behind
		// it — objects behind glass intermittently vanished depending on draw order.
		expect(GLASS_MATERIAL.transparent).toBe(true);
		expect(GLASS_MATERIAL.depthWrite).toBe(false);
	});

	it('attenuates once: transmission only, full opacity', () => {
		// Regression: opacity 0.3 stacked on transmission 0.95 double-attenuated, rendering glass
		// much darker than intended.
		expect(GLASS_MATERIAL.transmission).toBeCloseTo(0.95);
		expect(GLASS_MATERIAL.opacity).toBe(1);
	});
});

describe('polygon offset consistency', () => {
	// Regression: EMISSIVE/METAL/CONCRETE set polygonOffset: true with the default 0/0 factor and
	// units (a no-op), so edge overlays z-fought on exactly those three materials.
	it.each(Object.entries(ALL))('%s pushes surfaces back by 1/1', (_name, material) => {
		expect(material.polygonOffset).toBe(true);
		expect(material.polygonOffsetFactor).toBe(1);
		expect(material.polygonOffsetUnits).toBe(1);
	});
});

describe('CONCRETE_MATERIAL', () => {
	it('does not enable the alpha-test shader path', () => {
		// Regression: alphaTest 0.5 with no alpha map needlessly switched shader variants.
		expect(CONCRETE_MATERIAL.alphaTest).toBe(0);
	});
});

describe('SHARED_MATERIALS', () => {
	it('contains exactly the module singletons', () => {
		const singletons = Object.values(ALL);
		expect(SHARED_MATERIALS.size).toBe(singletons.length);
		for (const material of singletons) {
			expect(SHARED_MATERIALS.has(material)).toBe(true);
		}
	});

	it('does not claim foreign materials', () => {
		expect(SHARED_MATERIALS.has(new THREE.MeshStandardMaterial())).toBe(false);
	});
});
