import * as THREE from 'three';
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
		const follows = createMaterial(base({ metalness: 0 }), {
			appearance: { envMapIntensity: 0.55 }
		});

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

	it('compiles a separate program per finish, on top of the vertex-colour patch', () => {
		const brushed = createMaterial(base({ finish: 'brushed' }), {
			hasUvs: true,
			vertexColors: true
		});
		const rolled = createMaterial(base({ finish: 'rolled' }), { hasUvs: true, vertexColors: true });

		expect(brushed.defines?.USE_UV).toBe('');
		expect(brushed.customProgramCacheKey()).not.toBe(rolled.customProgramCacheKey());

		const shader = {
			vertexShader: '#include <color_vertex>',
			fragmentShader:
				'#include <common>\n#include <color_fragment>\n#include <roughnessmap_fragment>\n' +
				'#include <normal_fragment_begin>\n#include <normal_fragment_maps>',
			uniforms: {}
		} as unknown as THREE.WebGLProgramParametersWithUniforms;
		brushed.onBeforeCompile(shader, undefined as unknown as THREE.WebGLRenderer);
		const frag = shader.fragmentShader;
		expect(shader.vertexShader).toContain('vColor.rgb = mix');
		expect(frag).toContain('selvaFibres');
		// Declared in color_fragment, before its uses in roughness and the normal.
		expect(frag.indexOf('float selvaStreak')).toBeLessThan(
			frag.indexOf('roughnessFactor * ( 1.0 + selvaStreak )')
		);
		expect(frag.indexOf('float selvaFibre ')).toBeLessThan(
			frag.indexOf('selvaFibre * selvaAcross')
		);
		// The tilt goes after the normal exists.
		expect(frag.indexOf('#include <normal_fragment_maps>')).toBeLessThan(
			frag.indexOf('selvaFibre * selvaAcross')
		);
	});

	it('skips a finish without UVs', () => {
		expect(createMaterial(base({ finish: 'brushed' }), { hasUvs: false }).defines?.USE_UV).toBe(
			undefined
		);
	});

	it('keys the program on finish strength, and draws nothing at 0', () => {
		const strong = createMaterial(base({ finish: 'brushed', finishStrength: 2 }), { hasUvs: true });
		const plain = createMaterial(base({ finish: 'brushed' }), { hasUvs: true });
		expect(strong.customProgramCacheKey()).not.toBe(plain.customProgramCacheKey());

		const off = createMaterial(base({ finish: 'brushed', finishStrength: 0 }), { hasUvs: true });
		expect(off.defines?.USE_UV).toBe(undefined);
	});

	it('makes glass transmissive rather than transparent', () => {
		const glass = createMaterial(base({ metalness: 0, transmission: 1, ior: 1.52 }));
		expect(glass.transmission).toBe(1);
		expect(glass.ior).toBeCloseTo(1.52);
		expect(glass.transparent).toBe(false);
	});

	it('applies anisotropy only when the batch carries UVs', () => {
		const grain = base({ anisotropy: 0.7, anisotropyRotation: Math.PI / 2 });

		const withUvs = createMaterial(grain, { hasUvs: true });
		expect(withUvs.anisotropy).toBeCloseTo(0.7);
		expect(withUvs.anisotropyRotation).toBeCloseTo(Math.PI / 2);

		expect(createMaterial(grain, { hasUvs: false }).anisotropy).toBe(0);
	});
});
