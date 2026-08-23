import * as THREE from 'three';

import type { Look, LookPreset, MaterialAppearanceOptions } from './types.js';

/** The look applied when the caller passes no `look` option. */
export const DEFAULT_LOOK: Look = 'technical';

/**
 * Single source of truth for both `applyDefaults` (construction) and `setLook` (runtime), so the two
 * can't drift.
 *
 * `ambientOcclusion: false` on every look: GTAO is a heavy full-screen pass, so it stays opt-in
 * (`render.ambientOcclusion` or `setAmbientOcclusion(true)`) rather than costing every viewer 60fps.
 */
export const LOOK_PRESETS: Record<Look, LookPreset> = {
	// Fills shadows in (vs. showcase, which lets them fall off). IBL/fill kept modest so
	// env+hemisphere+ambient don't triple-stack into an ACES-washed look.
	studio: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 1.0,
		environmentIntensity: 1.0,
		hemisphereIntensity: 0.75,
		ambientIntensity: 0.4,
		cullBackfaces: false,
		ambientOcclusion: false
	},
	// Flat ambient kept low — a full flat ambient flattens shading toward milky grey regardless of
	// face orientation — with IBL near full and a little hemisphere fill for under-facing surfaces.
	technical: {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 0.9,
		environmentIntensity: 1,
		hemisphereIntensity: 0.35,
		ambientIntensity: 0.25,
		cullBackfaces: false,
		ambientOcclusion: false
	},
	// Fill pulled DOWN (low ambient/hemisphere) so light-to-shadow falloff stays strong for a
	// dramatic hero shot, unlike `studio` which fills shadows in.
	showcase: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1.15,
		envMapIntensity: 1.4,
		environmentIntensity: 1.25,
		hemisphereIntensity: 0.35,
		ambientIntensity: 0.15,
		cullBackfaces: false,
		ambientOcclusion: false
	}
};

/** Baked at parse time (not toggleable at runtime). */
export function materialAppearanceForLook(look: Look): MaterialAppearanceOptions {
	const preset = LOOK_PRESETS[look];
	return {
		envMapIntensity: preset.envMapIntensity,
		cullBackfaces: preset.cullBackfaces
	};
}
