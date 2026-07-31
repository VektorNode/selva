import type * as THREE from 'three';

// ============================================================================
// LOOKS
// ============================================================================

/**
 * `LOOKS` is the source of truth ({@link Look} derives from it) so consumers (e.g. a style picker)
 * can iterate instead of hardcoding names. 'technical' is first because it's the default.
 */
export const LOOKS = ['technical', 'studio', 'showcase'] as const;

export type Look = (typeof LOOKS)[number];

/**
 * The lighting/material dials a {@link Look} sets, shared by construction-time defaults and runtime
 * `setLook`. `envMapIntensity`/`cullBackfaces` are parse-time material choices (see
 * `materialAppearanceForLook`); the rest apply to the live scene. Never carries edges or grid —
 * those are independent overlays.
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

/**
 * How compute meshes read visually. Lives in `shared/` (not with the parser) so the render layer can
 * read a look's material dials via `materialAppearanceForLook` without importing upward into `parse/`.
 */
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
