import type * as THREE from 'three';

// ============================================================================
// LOOKS
// ============================================================================

/** Source of truth for {@link Look}: lets consumers (e.g. a style picker) iterate instead of hardcoding names. */
export const LOOKS = [
	'technical',
	'studio',
	'showcase',
	'arctic',
	'xray',
	'lineart',
	'wireframe'
] as const;

export type Look = (typeof LOOKS)[number];

/**
 * How a {@link Look} overrides the per-mesh material a solve produced. Omitted fields leave the
 * mesh's own value alone, so a look that sets none of them is purely a lighting change.
 *
 * These fight the model's real colours on purpose: `arctic` reads shape over material, `xray` reads
 * what is inside, `wireframe` reads topology. `setLook` snapshots the parsed values before the first
 * override and restores them when switching back, so the model's own colours survive a round trip.
 */
export type LookMaterialOverride = {
	/** Replaces the mesh's own colour. Hex, e.g. 0xf2f4f7. */
	color?: number;
	metalness?: number;
	roughness?: number;
	/** Forces `transparent: true` when below 1. */
	opacity?: number;
	/**
	 * Skip the depth buffer so far faces aren't hidden by near ones: what makes an x-ray read
	 * through the model instead of just looking like tinted glass. Costs correct sort order, which
	 * is the intended trade.
	 */
	depthWrite?: boolean;
	/**
	 * Draw each triangle as its three edges instead of a filled face. Shows the tessellation, not the
	 * design edges the `edges` overlay extracts: a curved surface reads as a dense triangle mesh.
	 * Lighting still applies but has almost nothing to shade, so a wireframe look wants flat fill
	 * rather than a key light.
	 */
	wireframe?: boolean;
};

/**
 * The lighting/material dials a {@link Look} sets. It still never *drives* the edge overlay or the
 * grid; `requiresEdges` only states that a look is incomplete without edges, and the host decides
 * whether to honour it.
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
	/**
	 * A key light casting a shadow. IBL alone lights every face of a box almost equally, so without
	 * this a model reads as a flat white silhouette: the directional falloff is what separates the
	 * three faces meeting at a corner.
	 */
	sunlightIntensity: number;
	/** Absent on the looks that only retune lighting. */
	materialOverride?: LookMaterialOverride;
	/**
	 * This look is a line drawing: without the edge overlay it renders as blank white shapes. Set
	 * only by `lineart`. A declaration, not an action: `setLook` still touches no overlay, so a
	 * host that ignores this gets a look that doesn't work rather than a broken invariant.
	 *
	 * A host honouring this must also turn `edges.distanceFade` off. The fade sets opacity per
	 * overlay from its 15th-percentile segment length, so one finely-detailed mesh fades whole:
	 * in a shaded look that softens some outlines, but here it erases parts of the only thing being
	 * drawn, and the opacity is recomputed per frame so edges pop in and out while orbiting.
	 */
	requiresEdges?: boolean;
};

/** How compute meshes read visually: the parse-time material choices baked from a {@link Look}. */
export interface MaterialAppearanceOptions {
	/** Default 1 (three.js's own material default) when omitted. */
	envMapIntensity?: number;
	/**
	 * `THREE.FrontSide` instead of `THREE.DoubleSide`: crisper silhouette on closed solids, but open
	 * surfaces (which Rhino also emits) vanish when viewed from behind. Default false (DoubleSide) to
	 * stay safe for surface geometry.
	 */
	cullBackfaces?: boolean;
}
