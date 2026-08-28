import * as THREE from 'three';

import type { Look, LookPreset, MaterialAppearanceOptions } from './types.js';

/** The look applied when the caller passes no `look` option. */
export const DEFAULT_LOOK: Look = 'technical';

/**
 * Single source of truth for both `applyDefaults` (construction) and `setLook` (runtime), so the two
 * can't drift.
 *
 * Every shaded look pairs a key light with contact shading (GTAO), because image-based lighting on
 * its own lights all faces of a box nearly equally — the result is a white silhouette with no
 * readable form. GTAO is a full-screen pass and does cost frames; `xray` skips it since there are no
 * opaque contacts left to shade.
 */
export const LOOK_PRESETS: Record<Look, LookPreset> = {
	// Fills shadows in (vs. showcase, which lets them fall off), but still key-lit: ACES plus a
	// moderate sun, with fill high enough that shadowed faces keep detail.
	studio: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 1.0,
		environmentIntensity: 0.85,
		hemisphereIntensity: 0.5,
		ambientIntensity: 0.25,
		cullBackfaces: false,
		ambientOcclusion: true,
		sunlightIntensity: 1.6
	},
	// The sun carries this look and the ambient/IBL only lift shadows off black. Fill was the thing
	// making it read as flat white paper: every source except the sun is orientation-independent, so
	// the more of them you stack the less the three faces of a corner differ.
	technical: {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1,
		envMapIntensity: 0.55,
		environmentIntensity: 0.6,
		hemisphereIntensity: 0.25,
		ambientIntensity: 0.15,
		cullBackfaces: false,
		ambientOcclusion: true,
		sunlightIntensity: 2.2
	},
	// Fill pulled furthest DOWN and the sun pushed hardest, so light-to-shadow falloff is steepest —
	// a dramatic hero shot, unlike `studio` which fills shadows back in.
	showcase: {
		toneMapping: THREE.ACESFilmicToneMapping,
		toneMappingExposure: 1.15,
		envMapIntensity: 1.4,
		environmentIntensity: 1.0,
		hemisphereIntensity: 0.2,
		ambientIntensity: 0.1,
		cullBackfaces: false,
		ambientOcclusion: true,
		sunlightIntensity: 2.6
	},
	// Every mesh forced to one near-white clay, so form and shadow carry the image instead of the
	// model's own colours. AO on: with all albedo differences gone, contact shading is the only thing
	// left separating touching parts — without it the model reads as one white blob.
	arctic: {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1.05,
		envMapIntensity: 0.85,
		environmentIntensity: 1.1,
		hemisphereIntensity: 0.3,
		ambientIntensity: 0.15,
		cullBackfaces: false,
		ambientOcclusion: true,
		sunlightIntensity: 2.0,
		materialOverride: {
			color: 0xeef1f5,
			metalness: 0,
			roughness: 0.75
		}
	},
	// See-through blue-white with depth writes off, so interior geometry shows through the shell.
	// Exposure pushed up because stacked transparent layers darken fast; the sun is dialled back
	// because a hard highlight on a transparent shell hides what is behind it.
	xray: {
		toneMapping: THREE.NeutralToneMapping,
		toneMappingExposure: 1.3,
		envMapIntensity: 0.4,
		environmentIntensity: 0.8,
		hemisphereIntensity: 0.6,
		ambientIntensity: 0.6,
		cullBackfaces: false,
		ambientOcclusion: false,
		sunlightIntensity: 0.6,
		materialOverride: {
			color: 0x9fc4e8,
			metalness: 0,
			roughness: 0.9,
			opacity: 0.28,
			depthWrite: false
		}
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
