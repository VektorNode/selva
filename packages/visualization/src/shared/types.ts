import type * as THREE from 'three';

// ============================================================================
// LOOKS
// ============================================================================

/**
 * The ready-to-go viewer looks:
 *
 * - 'technical': clean shaded CAD read — neutral tone mapping, IBL-led so the object keeps form.
 * - 'studio': balanced presentation — ACES tone mapping, hemisphere fill + lifted HDR so results are
 *   well-lit regardless of the HDR, without washing colour out. The polished "product shot" look.
 * - 'showcase': punchier presentation — ACES, stronger IBL/fill and a touch more exposure.
 */
/**
 * The look values as a runtime array — the single source of truth. {@link Look} is derived from it, so
 * the type and the enumerable list can never drift. Consumers (e.g. a viewer's style picker) iterate
 * this instead of hardcoding the names, so adding or renaming a look here updates them automatically.
 * 'technical' is first because it's the default.
 */
export const LOOKS = ['technical', 'studio', 'showcase'] as const;

export type Look = (typeof LOOKS)[number];

/**
 * The lighting/material dials a {@link Look} sets. Single source of truth shared by construction-time
 * defaults and the runtime `setLook`, so the two never drift. `envMapIntensity` and `cullBackfaces`
 * are parse-time material choices (see the batch parser's `material` option, exposed via
 * `materialAppearanceForLook`); the rest are applied to the live scene. A look does NOT carry edges
 * or grid — those are independent overlay concerns.
 */
export type LookPreset = {
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** IBL reflection strength on compute materials (parse-time material choice). */
	envMapIntensity: number;
	/**
	 * Uniform multiplier on the HDR's image-based lighting (`scene.environmentIntensity`). The
	 * 'studio'/'showcase' looks lift this above 1 so results stay bright regardless of the HDR.
	 */
	environmentIntensity: number;
	/**
	 * Hemisphere fill strength. The 'studio'/'showcase' looks turn it on (direction-aware fill that
	 * lifts shadowed / under-facing surfaces a dark HDR leaves black); 'technical' keeps it 0.
	 */
	hemisphereIntensity: number;
	/**
	 * Flat ambient strength. Kept low on 'studio'/'showcase' so the hemisphere fill carries the lift
	 * without the flat white ambient desaturating colour.
	 */
	ambientIntensity: number;
	/** Cull back faces on compute meshes (parse-time material choice; crisper solids). */
	cullBackfaces: boolean;
	ambientOcclusion: boolean;
};

/**
 * How compute meshes read visually. Bundled so a caller can pick a coherent look ('technical' vs
 * 'rendered') by setting all three together rather than dialing each in isolation.
 *
 * Lives in `shared/` rather than with the parser so the render layer can read a look's material
 * dials (via `materialAppearanceForLook`) without importing upward into `parse/`.
 */
export interface MaterialAppearanceOptions {
	/**
	 * Multiplier on the HDR image-based-lighting reflection strength. ~0.5 reads matte/technical,
	 * ~1.3 reads glossy/presentation. Default 1 (three.js's own default — unchanged look).
	 */
	envMapIntensity?: number;
	/**
	 * Cull back faces (`THREE.FrontSide`) instead of rendering both sides (`THREE.DoubleSide`).
	 * FrontSide gives cleaner interior shading, a crisper silhouette, and less overdraw on closed
	 * solids — but open surfaces (which Rhino also emits) then vanish when viewed from behind.
	 * Default false (keep DoubleSide) to stay safe for surface geometry.
	 */
	cullBackfaces?: boolean;
}
