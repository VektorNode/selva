import type * as THREE from 'three';

// ============================================================================
// LOOKS
// ============================================================================

/**
 * The ready-to-go viewer looks:
 * - 'technical': clean shaded CAD read — neutral tone mapping, IBL-led so the object keeps form.
 * - 'studio': balanced "product shot" — ACES, hemisphere fill + lifted HDR, well-lit without washing
 *   colour out.
 * - 'showcase': punchier presentation — ACES, stronger IBL/fill, a touch more exposure.
 *
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
	/** IBL reflection strength on compute materials (parse-time material choice). */
	envMapIntensity: number;
	/** Multiplier on the HDR's IBL (`scene.environmentIntensity`). 'studio'/'showcase' lift above 1 so results stay bright regardless of the HDR. */
	environmentIntensity: number;
	/** Direction-aware fill lifting shadowed/under-facing surfaces a dark HDR leaves black. 'technical' keeps it 0. */
	hemisphereIntensity: number;
	/** Flat ambient strength — kept low on 'studio'/'showcase' so hemisphere fill carries the lift without desaturating colour. */
	ambientIntensity: number;
	/** Cull back faces on compute meshes (parse-time material choice; crisper solids). */
	cullBackfaces: boolean;
	ambientOcclusion: boolean;
};

/**
 * How compute meshes read visually. Lives in `shared/` (not with the parser) so the render layer can
 * read a look's material dials via `materialAppearanceForLook` without importing upward into `parse/`.
 */
export interface MaterialAppearanceOptions {
	/** IBL reflection strength. ~0.5 reads matte/technical, ~1.3 glossy/presentation. Default 1 (three.js's own default). */
	envMapIntensity?: number;
	/**
	 * `THREE.FrontSide` instead of `THREE.DoubleSide` — crisper silhouette on closed solids, but open
	 * surfaces (which Rhino also emits) vanish when viewed from behind. Default false (DoubleSide) to
	 * stay safe for surface geometry.
	 */
	cullBackfaces?: boolean;
}
