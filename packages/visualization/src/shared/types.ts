import type * as THREE from 'three';

// ============================================================================
// LOOKS
// ============================================================================

/** Source of truth for {@link Look} — lets consumers (e.g. a style picker) iterate instead of hardcoding names. */
export const LOOKS = ['technical', 'studio', 'showcase'] as const;

export type Look = (typeof LOOKS)[number];

/**
 * The lighting/material dials a {@link Look} sets. Never carries edges or grid — those are
 * independent overlays.
 */
export type LookPreset = {
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	envMapIntensity: number;
	/** Multiplier on the HDR's IBL (`scene.environmentIntensity`). */
	environmentIntensity: number;
	hemisphereIntensity: number;
	ambientIntensity: number;
	cullBackfaces: boolean;
	ambientOcclusion: boolean;
};

/** How compute meshes read visually — the parse-time material choices baked from a {@link Look}. */
export interface MaterialAppearanceOptions {
	/** Default 1 (three.js's own material default) when omitted. */
	envMapIntensity?: number;
	/**
	 * `THREE.FrontSide` instead of `THREE.DoubleSide` — crisper silhouette on closed solids, but open
	 * surfaces (which Rhino also emits) vanish when viewed from behind. Default false (DoubleSide) to
	 * stay safe for surface geometry.
	 */
	cullBackfaces?: boolean;
}
