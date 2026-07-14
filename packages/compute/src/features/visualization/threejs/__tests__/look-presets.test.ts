import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { applyDefaults, materialAppearanceForLook, LOOK_PRESETS } from '../three-initializer';
import type { Look, LookPreset } from '../../types';

// Characterization tests for the `look` preset system: the option-precedence resolver in
// applyDefaults, the default look, the lighting-vs-overlay decoupling, and preset shape.
// (initThree's runtime setLook needs a real WebGL canvas, so it isn't exercised here.)

const ALL_LOOKS: Look[] = ['studio', 'technical', 'showcase'];

describe('LOOK_PRESETS', () => {
	const requiredFields: (keyof LookPreset)[] = [
		'toneMapping',
		'toneMappingExposure',
		'envMapIntensity',
		'environmentIntensity',
		'hemisphereIntensity',
		'ambientIntensity',
		'cullBackfaces',
		'ambientOcclusion'
	];

	it.each(ALL_LOOKS)('%s defines every LookPreset field', (look) => {
		const preset = LOOK_PRESETS[look];
		for (const field of requiredFields) {
			expect(preset[field], `${look}.${field}`).not.toBeUndefined();
		}
	});

	it('studio is the balanced pro look (ACES, hemisphere fill on, low ambient)', () => {
		expect(LOOK_PRESETS.studio.toneMapping).toBe(THREE.ACESFilmicToneMapping);
		expect(LOOK_PRESETS.studio.hemisphereIntensity).toBeGreaterThan(0);
		expect(LOOK_PRESETS.studio.ambientIntensity).toBeLessThan(1);
	});

	it('technical is the clean shaded CAD look (neutral, IBL-led, low flat ambient + light fill)', () => {
		expect(LOOK_PRESETS.technical.toneMapping).toBe(THREE.NeutralToneMapping);
		// IBL-led: env carries the shading (near full), flat ambient is only a thin floor, and a little
		// hemisphere fill lifts under-facing surfaces — no more form-killing full flat ambient.
		expect(LOOK_PRESETS.technical.envMapIntensity).toBeGreaterThanOrEqual(0.8);
		expect(LOOK_PRESETS.technical.hemisphereIntensity).toBeGreaterThan(0);
		expect(LOOK_PRESETS.technical.ambientIntensity).toBeLessThan(0.5);
		expect(LOOK_PRESETS.technical.environmentIntensity).toBe(1);
	});

	it.each(ALL_LOOKS)('%s ships with ambient occlusion off (heavy GTAO path is opt-in)', (look) => {
		expect(LOOK_PRESETS[look].ambientOcclusion).toBe(false);
	});
});

describe('applyDefaults — look seeds lighting defaults', () => {
	it('defaults to the technical look when no look is passed', () => {
		const config = applyDefaults({});
		expect(config.look).toBe('technical');
		// technical values land in the resolved lighting/render config.
		expect(config.render.toneMapping).toBe(LOOK_PRESETS.technical.toneMapping);
		expect(config.lighting.hemisphereIntensity).toBe(LOOK_PRESETS.technical.hemisphereIntensity);
		expect(config.lighting.ambientLightIntensity).toBe(LOOK_PRESETS.technical.ambientIntensity);
		expect(config.environment.environmentIntensity).toBe(
			LOOK_PRESETS.technical.environmentIntensity
		);
		expect(config.render.ambientOcclusion).toBe(LOOK_PRESETS.technical.ambientOcclusion);
	});

	it('a chosen look seeds that preset', () => {
		const config = applyDefaults({ look: 'technical' });
		expect(config.look).toBe('technical');
		expect(config.render.toneMapping).toBe(THREE.NeutralToneMapping);
		expect(config.lighting.hemisphereIntensity).toBe(LOOK_PRESETS.technical.hemisphereIntensity);
		expect(config.lighting.enableHemisphereLight).toBe(true); // positive fill → hemisphere light on
		expect(config.lighting.ambientLightIntensity).toBe(LOOK_PRESETS.technical.ambientIntensity);
	});

	it('enables the hemisphere light when the look has positive fill', () => {
		expect(applyDefaults({ look: 'studio' }).lighting.enableHemisphereLight).toBe(true);
		expect(applyDefaults({ look: 'showcase' }).lighting.enableHemisphereLight).toBe(true);
	});
});

describe('applyDefaults — explicit options beat the look preset', () => {
	it('explicit exposure wins over the preset', () => {
		const config = applyDefaults({ look: 'studio', render: { toneMappingExposure: 2.5 } });
		expect(config.render.toneMappingExposure).toBe(2.5);
	});

	it('explicit NoToneMapping (=== 0) is honoured, not dropped', () => {
		// Regression guard: this field used || previously, which would discard the falsy 0 value.
		const config = applyDefaults({
			look: 'studio',
			render: { toneMapping: THREE.NoToneMapping }
		});
		expect(config.render.toneMapping).toBe(THREE.NoToneMapping);
	});

	it('explicit hemisphere / ambient / environment intensity win over the preset', () => {
		const config = applyDefaults({
			look: 'studio',
			lighting: { hemisphereIntensity: 0.1, ambientLightIntensity: 0.9 },
			environment: { environmentIntensity: 0.5 }
		});
		expect(config.lighting.hemisphereIntensity).toBe(0.1);
		expect(config.lighting.ambientLightIntensity).toBe(0.9);
		expect(config.environment.environmentIntensity).toBe(0.5);
	});

	it('explicit ambientOcclusion:true wins over a preset that leaves it off', () => {
		const config = applyDefaults({ look: 'studio', render: { ambientOcclusion: true } });
		expect(config.render.ambientOcclusion).toBe(true);
	});
});

describe('applyDefaults — looks are decoupled from overlays', () => {
	it('no look turns on edges or grid — they stay off by default', () => {
		for (const look of ALL_LOOKS) {
			const config = applyDefaults({ look });
			expect(config.grid.enabled, `${look} grid`).toBe(false);
			expect(config.edges.enabled, `${look} edges`).toBe(false);
		}
	});

	it('overlays are driven only by their own config, regardless of look', () => {
		const config = applyDefaults({
			look: 'studio',
			grid: { enabled: true },
			edges: { enabled: true }
		});
		expect(config.grid.enabled).toBe(true);
		expect(config.edges.enabled).toBe(true);
	});
});

describe('materialAppearanceForLook', () => {
	it.each(ALL_LOOKS)('%s returns the preset envMapIntensity + cullBackfaces', (look) => {
		const appearance = materialAppearanceForLook(look);
		expect(appearance.envMapIntensity).toBe(LOOK_PRESETS[look].envMapIntensity);
		expect(appearance.cullBackfaces).toBe(LOOK_PRESETS[look].cullBackfaces);
	});
});
