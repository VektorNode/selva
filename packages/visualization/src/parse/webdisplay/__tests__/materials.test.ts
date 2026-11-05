import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { OWN_ENV_MAP_INTENSITY, isGlass } from '../../../shared/index.js';
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

	it('blends a pane instead of using transmission, so panes behind it still show', () => {
		const pane = createMaterial(
			base({ metalness: 0, roughness: 0.05, transmission: 1, ior: 1.52 }),
			{
				closed: true
			}
		);
		expect(pane.transmission).toBe(0);
		expect(pane.transparent).toBe(true);
		expect(pane.opacity).toBeLessThan(0.1);
		expect(pane.depthWrite).toBe(false);
		expect(pane.ior).toBeCloseTo(1.52);
		// Its far face would reflect a second time.
		expect(pane.side).toBe(THREE.FrontSide);
		expect(isGlass(pane)).toBe(true);
	});

	it('gives glass with a thickness real transmission and its tint', () => {
		const block = createMaterial(
			base({ metalness: 0, transmission: 1, thickness: 400, attenuationColor: '#6fb7a4' })
		);
		expect(block.transmission).toBe(1);
		expect(block.thickness).toBe(400);
		expect(block.attenuationDistance).toBe(400);
		expect(block.attenuationColor.getHexString()).not.toBe('ffffff');
		expect(block.transparent).toBe(false);
		expect(isGlass(block)).toBe(true);
	});

	it('gives rough glass transmission even without a thickness, so it blurs what is behind', () => {
		const frosted = createMaterial(base({ metalness: 0, roughness: 0.45, transmission: 1 }));
		expect(frosted.transmission).toBe(1);
		expect(frosted.transparent).toBe(false);
		expect(frosted.thickness).toBe(0);
	});

	it('applies sheen with its colour and roughness', () => {
		const soft = createMaterial(
			base({ metalness: 0, sheen: 1, sheenColor: '#8a8d90', sheenRoughness: 0.6 })
		);
		expect(soft.sheen).toBe(1);
		expect(soft.sheenRoughness).toBeCloseTo(0.6);
		expect(soft.sheenColor.getHexString()).not.toBe('000000');
		expect(createMaterial(base()).sheen).toBe(0);
	});

	it('leaves a material without transmission out of the glass handling', () => {
		expect(isGlass(createMaterial(base({ transmission: 0 })))).toBe(false);
	});

	it('applies anisotropy only when the batch carries UVs', () => {
		const grain = base({ anisotropy: 0.7, anisotropyRotation: Math.PI / 2 });

		const withUvs = createMaterial(grain, { hasUvs: true });
		expect(withUvs.anisotropy).toBeCloseTo(0.7);
		expect(withUvs.anisotropyRotation).toBeCloseTo(Math.PI / 2);

		expect(createMaterial(grain, { hasUvs: false }).anisotropy).toBe(0);
	});
});

describe('createMaterial: sun on metal', () => {
	const compile = (material: THREE.Material) => {
		const shader = {
			fragmentShader: THREE.ShaderLib.physical.fragmentShader,
			vertexShader: THREE.ShaderLib.physical.vertexShader,
			uniforms: {}
		} as unknown as THREE.WebGLProgramParametersWithUniforms;
		material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
		return shader.fragmentShader;
	};

	it('wraps the directional lights, and only them, in a metal', () => {
		// Fails when a three upgrade moves the light loop's markers: the patch would silently no-op.
		const fragment = compile(createMaterial(base({ metalness: 1 })));
		expect(fragment.match(/specularBeforeSun/g)).toHaveLength(3);
		expect(fragment.indexOf('specularBeforeSun')).toBeLessThan(
			fragment.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )')
		);
	});

	it('leaves a dielectric alone', () => {
		expect(compile(createMaterial(base({ metalness: 0 })))).not.toContain('specularBeforeSun');
	});
});
