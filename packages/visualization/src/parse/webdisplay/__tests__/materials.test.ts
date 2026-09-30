import { describe, expect, it } from 'vitest';

import { OWN_ENV_MAP_INTENSITY } from '../../../shared/index.js';
import { createMaterial } from '../batch/materials.js';

import type { SerializableMaterial } from '../types.js';

const base = (extra: Partial<SerializableMaterial> = {}): SerializableMaterial => ({
	color: '#ffffff',
	metalness: 0.9,
	roughness: 0.4,
	opacity: 1,
	transparent: false,
	...extra
});

describe('createMaterial: optional wire fields', () => {
	it('lets the material envMapIntensity beat the look', () => {
		const own = createMaterial(base({ envMapIntensity: 1 }), {
			appearance: { envMapIntensity: 0.55 }
		});
		const follows = createMaterial(base(), { appearance: { envMapIntensity: 0.55 } });

		expect(own.envMapIntensity).toBe(1);
		// setLook reads it back from here.
		expect(own.userData[OWN_ENV_MAP_INTENSITY]).toBe(1);
		expect(follows.envMapIntensity).toBe(0.55);
	});

	it('uses an explicit clearcoat, including 0 for bare metal', () => {
		const bare = createMaterial(base({ clearcoat: 0 }));
		const coated = createMaterial(base({ metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.1 }));

		expect(bare.clearcoat).toBe(0);
		expect(coated.clearcoat).toBe(0.8);
		expect(coated.clearcoatRoughness).toBeCloseTo(0.1);
	});

	it('applies anisotropy only when the batch carries UVs', () => {
		const grain = base({ anisotropy: 0.7, anisotropyRotation: Math.PI / 2 });

		const withUvs = createMaterial(grain, { hasUvs: true });
		expect(withUvs.anisotropy).toBeCloseTo(0.7);
		expect(withUvs.anisotropyRotation).toBeCloseTo(Math.PI / 2);

		expect(createMaterial(grain, { hasUvs: false }).anisotropy).toBe(0);
	});
});
