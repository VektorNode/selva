import * as THREE from 'three';

import type { Look, LookPreset, MaterialAppearanceOptions } from './types.js';

/** The look applied when the caller passes no `look` option. */
export const DEFAULT_LOOK: Look = 'technical';

/**
 * The ready-to-go looks, as concrete lighting/material dial values. Single source of truth for both
 * `applyDefaults` (construction) and `setLook` (runtime), so the two can't drift. A look carries ONLY
 * lighting/material — never edges or grid (independent overlays).
 *
 * `ambientOcclusion: false` on every look: GTAO is a heavy full-screen pass, so it stays opt-in
 * (`render.ambientOcclusion` or `setAmbientOcclusion(true)`) rather than costing every viewer 60fps.
 */
export const LOOK_PRESETS: Record<Look, LookPreset> = {
	// Soft, even product shot: ACES with generous, balanced fill so shadows read open — the safe
	// default. IBL/fill kept modest so env+hemisphere+ambient don't triple-stack into an ACES-washed
	// look. Distinct from `showcase`: this fills shadows in, showcase lets them fall off for drama.
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
	// Clean shaded CAD look: neutral tone mapping, IBL-led so the object keeps form. Flat ambient is
	// kept low (a full flat ambient flattens shading toward milky grey regardless of face orientation)
	// with IBL near full and a little hemisphere fill for under-facing surfaces instead.
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
	// Dramatic hero shot: higher exposure + reflective IBL for glossy pop, with fill pulled DOWN (low
	// ambient/hemisphere) so light-to-shadow falloff stays strong. Where `studio` fills shadows in,
	// showcase lets them fall off.
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

/** The material-parse options implied by a look (backface culling, IBL strength) — baked at parse time, not toggleable at runtime. */
export function materialAppearanceForLook(look: Look): MaterialAppearanceOptions {
	const preset = LOOK_PRESETS[look];
	return {
		envMapIntensity: preset.envMapIntensity,
		cullBackfaces: preset.cullBackfaces
	};
}
