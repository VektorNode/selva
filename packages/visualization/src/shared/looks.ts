import * as THREE from 'three';

import type { Look, LookPreset, MaterialAppearanceOptions } from './types.js';

/** The look applied when the caller passes no `look` option. */
export const DEFAULT_LOOK: Look = 'technical';

/**
 * The ready-to-go looks, as concrete lighting/material dial values. Single source of truth: consumed
 * by `applyDefaults` to seed construction-time defaults AND by `setLook` to re-apply a look at
 * runtime, so the two paths can never drift. A look carries ONLY lighting/material — never edges or
 * grid (those are independent overlays). See {@link Look} for what each reads like.
 *
 * Every look ships with `ambientOcclusion: false`: GTAO is a heavy full-screen postprocessing path
 * that can dominate frame time, so it stays opt-in (via `render.ambientOcclusion` or the runtime
 * `setAmbientOcclusion(true)`) rather than costing every viewer 60fps by default.
 */
export const LOOK_PRESETS: Record<Look, LookPreset> = {
	// Soft, even product shot: ACES with generous, balanced fill (hemisphere + a little flat ambient)
	// so the whole object stays legible and shadows read open — the safe, neutral default. IBL and fill
	// are kept modest so their contributions don't triple-stack (env + hemisphere + ambient) and push
	// midtones toward white — ACES then desaturates that lift, which reads as "washed out". Distinct
	// from `showcase`: this fills the shadows in; showcase deliberately lets them fall off for drama.
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
	// Clean shaded CAD look: neutral tone mapping, IBL-led so the object keeps FORM. The old dial
	// (ambient 1 + IBL 0.5) was the classic PBR wash — a full flat ambient adds the same value to
	// every face regardless of orientation, flattening shading toward a milky grey, while the one
	// light that actually shapes the surface (the HDR env) was cut to half. Rebalanced per the
	// community rule "let the env map carry the fill, keep flat ambient low": IBL back up to near
	// full, a little direction-aware hemisphere fill to lift under-facing surfaces (what ambient was
	// really being used for), and flat ambient dropped to a thin floor so nothing goes pure black.
	// Still a flat, even, edge-friendly read — just with shape and a hint of material response back.
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
	// Dramatic hero shot: pushes exposure and reflective IBL for glossy pop, but deliberately pulls the
	// flat fill DOWN (low ambient, lean hemisphere) so light-to-shadow falloff stays strong and form
	// reads with contrast. Where `studio` fills the shadows in for even legibility, showcase lets them
	// fall off. Still trimmed below the old triple-stacked values so the punch doesn't tip into the
	// ACES wash — the drama comes from higher exposure + IBL against lower fill, not from stacking lift.
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

/**
 * The material-parse options implied by a look — feed these into the batch parser's `material` option
 * so meshes are built to match it (backface culling, IBL strength). Kept out of the viewer's runtime
 * dials because they're baked at parse time, not toggleable in place.
 */
export function materialAppearanceForLook(look: Look): MaterialAppearanceOptions {
	const preset = LOOK_PRESETS[look];
	return {
		envMapIntensity: preset.envMapIntensity,
		cullBackfaces: preset.cullBackfaces
	};
}
