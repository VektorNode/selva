import { describe, expect, it } from 'vitest';

import { finishPatch } from '../batch/finish';

const CHUNKS = [
	'#include <common>',
	'#include <color_fragment>',
	'#include <roughnessmap_fragment>',
	'#include <normal_fragment_maps>'
].join('\n');

function patched(finish: Parameters<typeof finishPatch>[0], strength = 1) {
	const shader = { fragmentShader: CHUNKS } as Parameters<
		NonNullable<ReturnType<typeof finishPatch>>['patch']
	>[0];
	finishPatch(finish, strength)!.patch(shader);
	return shader.fragmentShader;
}

describe('surface finishes', () => {
	it.each(['wood', 'concrete', 'plaster', 'brick', 'corten'] as const)(
		'%s drives colour, roughness and relief',
		(finish) => {
			const source = patched(finish);
			expect(source).toContain('diffuseColor.rgb *=');
			expect(source).toContain('roughnessFactor =');
			expect(source).toContain('normal = normalize');
			expect(source).not.toContain('#include <common>\n\n#include');
		}
	);

	it('keeps relief recessed on the back of a double-sided surface', () => {
		expect(patched('brick')).toContain('dot( dx, r1 ) * faceDirection');
	});

	it('gives each finish and strength its own program', () => {
		const keys = new Set([
			finishPatch('wood', 1)!.key,
			finishPatch('brick', 1)!.key,
			finishPatch('brick', 0.5)!.key
		]);
		expect(keys.size).toBe(3);
	});

	it('draws nothing at strength 0', () => {
		expect(finishPatch('concrete', 0)).toBeNull();
	});

	it('leaves the brushed and rolled grain to their own shader', () => {
		expect(finishPatch('brushed', 1)!.key).toBe('finish:brushed:1.0000');
	});
});
