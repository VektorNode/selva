import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { LOOKS, LOOK_PRESETS, materialAppearanceForLook } from '../../../shared/index.js';
import type { Look, LookPreset } from '../../types';
import { applyDefaults } from '../defaults';

// Characterization tests for the `look` preset system: the option-precedence resolver in
// applyDefaults, the default look, the lighting-vs-overlay decoupling, and preset shape.
// (initThree's runtime setLook needs a real WebGL canvas, so it isn't exercised here.)

const ALL_LOOKS: Look[] = [...LOOKS];

describe('LOOK_PRESETS', () => {
	const requiredFields: (keyof LookPreset)[] = [
		'toneMapping',
		'toneMappingExposure',
		'envMapIntensity',
		'environmentIntensity',
		'hemisphereIntensity',
		'ambientIntensity',
		'cullBackfaces',
		'ambientOcclusion',
		'sunlightIntensity'
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
		// Fills shadows back in, so its sun sits below showcase's.
		expect(LOOK_PRESETS.studio.sunlightIntensity).toBeLessThan(
			LOOK_PRESETS.showcase.sunlightIntensity
		);
	});

	it('technical is the clean shaded CAD look (neutral, sun-led, fill only lifts shadows off black)', () => {
		expect(LOOK_PRESETS.technical.toneMapping).toBe(THREE.NeutralToneMapping);
		// Sun-led: the key light carries the shading and every other source is a thin floor under it.
		// Fill was what made this look read as flat white paper.
		expect(LOOK_PRESETS.technical.sunlightIntensity).toBeGreaterThan(1.5);
		expect(LOOK_PRESETS.technical.hemisphereIntensity).toBeGreaterThan(0);
		expect(LOOK_PRESETS.technical.ambientIntensity).toBeLessThan(0.25);
		expect(LOOK_PRESETS.technical.environmentIntensity).toBeLessThan(1);
	});

	// The regression these guard: IBL plus flat fill alone lights every face of a box nearly
	// equally, so the model renders as a white silhouette. A key light and contact shading are what
	// make form readable, and every opaque look must carry both.
	it.each(ALL_LOOKS.filter((look) => look !== 'xray'))(
		'%s key-lights the scene and enables contact shading',
		(look) => {
			expect(LOOK_PRESETS[look].sunlightIntensity).toBeGreaterThan(1);
			expect(LOOK_PRESETS[look].ambientOcclusion).toBe(true);
		}
	);

	// Ambient and hemisphere light every face the same regardless of orientation, so stacking them
	// above the key light is what flattens a model out. xray is exempt: it is deliberately fill-led,
	// since a hard highlight on a transparent shell hides the geometry behind it.
	it.each(ALL_LOOKS.filter((look) => look !== 'xray'))(
		'%s keeps orientation-independent fill below the sun',
		(look) => {
			const preset = LOOK_PRESETS[look];
			const flatFill = preset.ambientIntensity + preset.hemisphereIntensity;
			expect(flatFill, `${look} flat fill`).toBeLessThan(preset.sunlightIntensity);
		}
	);

	it('arctic and xray override materials; the lighting-only looks do not', () => {
		expect(LOOK_PRESETS.arctic.materialOverride?.color).toBeDefined();
		expect(LOOK_PRESETS.xray.materialOverride?.opacity).toBeLessThan(1);
		// depthWrite off is what makes x-ray read through the model rather than look like glass.
		expect(LOOK_PRESETS.xray.materialOverride?.depthWrite).toBe(false);
		for (const look of ['technical', 'studio', 'showcase'] as const) {
			expect(LOOK_PRESETS[look].materialOverride, look).toBeUndefined();
		}
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

	// GTAO is a full-screen pass; a host on a weak GPU must be able to decline it.
	it('explicit ambientOcclusion:false wins over a preset that turns it on', () => {
		const config = applyDefaults({ look: 'studio', render: { ambientOcclusion: false } });
		expect(config.render.ambientOcclusion).toBe(false);
	});

	it('explicit sunlightIntensity wins over the preset', () => {
		const config = applyDefaults({ look: 'technical', lighting: { sunlightIntensity: 0.3 } });
		expect(config.lighting.sunlightIntensity).toBe(0.3);
	});

	it('the look seeds the sun when the host passes none', () => {
		expect(applyDefaults({ look: 'showcase' }).lighting.sunlightIntensity).toBe(
			LOOK_PRESETS.showcase.sunlightIntensity
		);
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

// `ResolvedOptions` is `Required<...>` only at the top level, so `edges` keeps EdgesConfig's optional
// members — a field that applyDefaults forgets to copy is a silent drop, not a type error. That is
// exactly how maxTriangles/maxSegments/screenSpaceFallback were lost: documented, read by
// init-three's applyEdges/updateEdgeFallback, and never carried across from the caller's options.
describe('applyDefaults — every EdgesConfig field survives resolution', () => {
	it('carries the caps and the screen-space fallback through', () => {
		const config = applyDefaults({
			edges: { maxTriangles: 123_456, maxSegments: 7_890, screenSpaceFallback: false }
		});
		expect(config.edges.maxTriangles).toBe(123_456);
		expect(config.edges.maxSegments).toBe(7_890);
		expect(config.edges.screenSpaceFallback).toBe(false);
	});

	// Left undefined rather than restated here: the canonical 4M/2M defaults live in
	// `edges/options.ts` resolveOptions, and applyEdges forwards these straight to it.
	it('leaves the caps undefined when unset so edges/options.ts owns the defaults', () => {
		const config = applyDefaults({});
		expect(config.edges.maxTriangles).toBeUndefined();
		expect(config.edges.maxSegments).toBeUndefined();
		expect(config.edges.screenSpaceFallback).toBeUndefined();
	});

	it('copies across every key the caller supplied', () => {
		const edges = {
			enabled: true,
			color: 0x123456,
			darken: 0.4,
			width: 3,
			thresholdAngle: 12,
			distanceFade: false,
			maxTriangles: 1,
			maxSegments: 2,
			screenSpaceFallback: true
		} as const;
		const resolved = applyDefaults({ edges }).edges;
		for (const key of Object.keys(edges) as (keyof typeof edges)[]) {
			expect(resolved[key], `edges.${key} dropped by applyDefaults`).toBe(edges[key]);
		}
	});
});

describe('materialAppearanceForLook', () => {
	it.each(ALL_LOOKS)('%s returns the preset envMapIntensity + cullBackfaces', (look) => {
		const appearance = materialAppearanceForLook(look);
		expect(appearance.envMapIntensity).toBe(LOOK_PRESETS[look].envMapIntensity);
		expect(appearance.cullBackfaces).toBe(LOOK_PRESETS[look].cullBackfaces);
	});
});
