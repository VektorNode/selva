import * as THREE from 'three';

export type CameraConfig = {
	position?: THREE.Vector3;
	fov?: number;
	near?: number;
	far?: number;
	target?: THREE.Vector3;
	/**
	 * Refit the near plane to the camera↔content gap every frame (default true) — recovers
	 * depth-buffer precision when zoomed out, preventing distant z-fighting. `near` is only ever
	 * raised, never lowered below the configured value.
	 */
	dynamicNear?: boolean;
};

export type LightingConfig = {
	enableSunlight?: boolean;
	sunlightIntensity?: number;
	sunlightPosition?: THREE.Vector3;
	ambientLightColor?: THREE.Color;
	ambientLightIntensity?: number;
	sunlightColor?: THREE.Color | number;
	/**
	 * Direction-aware fill (sky color above, ground color below) so surfaces facing away from the
	 * sun don't collapse to black under a dark HDR. Default false — enabling it shifts the look.
	 */
	enableHemisphereLight?: boolean;
	/** Default white. */
	hemisphereSkyColor?: THREE.Color | number;
	/** Default a mid grey. */
	hemisphereGroundColor?: THREE.Color | number;
	/** Default 0.6. Only applies when {@link LightingConfig.enableHemisphereLight}. */
	hemisphereIntensity?: number;
};

export type EnvironmentConfig = {
	hdrPath?: string;
	backgroundColor?: THREE.Color | string;
	enableEnvironmentLighting?: boolean;
	/**
	 * Defaults to `(0, 0, 1)` — Rhino's Z-up, not Three's native Y-up — because geometry arrives in
	 * Rhino's frame and is never rotated on ingress. Everything orientation-dependent derives from
	 * this (view presets, default camera, sun, grid, floor, hemisphere light), but overriding it
	 * reorients the viewer only — it does NOT rotate incoming geometry.
	 */
	sceneUp?: THREE.Vector3;
	showEnvironment?: boolean;
	/**
	 * Multiplier on the HDR's image-based lighting contribution — normalizes brightness across HDRs
	 * of differing exposure. Default 1 (unchanged look).
	 */
	environmentIntensity?: number;
};

export type FloorConfig = {
	enabled?: boolean;
	size?: number;
	color?: THREE.Color | string;
	roughness?: number;
	metalness?: number;
	receiveShadow?: boolean;
};

export type RenderConfig = {
	enableShadows?: boolean;
	shadowMapSize?: number;
	antialias?: boolean;
	pixelRatio?: number;
	toneMapping?: THREE.ToneMapping;
	toneMappingExposure?: number;
	preserveDrawingBuffer?: boolean;
	/** Default false — switches rendering from `renderer.render` to an EffectComposer, which costs more. */
	ambientOcclusion?: boolean;
	/** AO strength 0–1 when {@link RenderConfig.ambientOcclusion} is on. Default 1. */
	aoIntensity?: number;
	/**
	 * DPR cap for AO buffers — AO is low-frequency, so sampling below display DPR is nearly invisible
	 * but much cheaper (a DPR-2 display would otherwise push 4× the pixels through GTAO's per-pixel
	 * sample loop). Default 1; only relevant when AO is enabled.
	 */
	aoPixelRatio?: number;
	/**
	 * Render only on change (camera motion, invalidate(), pointer input, resize) plus a ~500ms safety
	 * repaint, instead of every frame. Default true — cuts idle GPU/battery use. Set false to restore
	 * a continuous loop.
	 */
	onDemand?: boolean;
};

import type { Look } from '../shared/index.js';

/**
 * A named bundle of lighting/material defaults, decoupled from CAD overlays (edges, grid — see
 * {@link EdgesConfig}/{@link GridConfig}). 'technical' (default) is matte CAD-shaded; 'studio' and
 * 'showcase' add ACES tone mapping and hemisphere fill for punchier presentation.
 *
 * Defined in `shared/` (both this layer and `parse/` need it, neither may import the other) and
 * re-exported here so `ThreeInitializerOptions` stays a self-contained option surface.
 */
export { LOOKS } from '../shared/index.js';
export type { Look, LookPreset, MaterialAppearanceOptions } from '../shared/index.js';

/** Crisp boundary/crease edge overlays on meshes. See `addEdges`. */
export type EdgesConfig = {
	/** Default false (opt-in). */
	enabled?: boolean;
	/** Omit (default) to derive each mesh's edge color from its own surface material, darkened by `darken`. */
	color?: THREE.ColorRepresentation;
	/** 0–1, default 0.75. Ignored when `color` is set. */
	darken?: number;
	/** CSS px. Default 1.5. */
	width?: number;
	/** Crease angle in degrees: keep edges where faces differ by more than this. Default 44. */
	thresholdAngle?: number;
	/** Fade an overlay out as its mesh shrinks on screen. Default true. */
	distanceFade?: boolean;
	/** Skip overlay extraction for meshes above this triangle count. Default 4M. */
	maxTriangles?: number;
	/** Overlays above this segment count render opaque (no distance fade). Default 2M. */
	maxSegments?: number;
	/** Meshes skipped for exceeding `maxTriangles` fall back to the screen-space edge-detection pass
	 * (constant cost regardless of triangle count). Default true. */
	screenSpaceFallback?: boolean;
};

export type ControlsConfig = {
	enableDamping?: boolean;
	dampingFactor?: number;
	autoRotate?: boolean;
	autoRotateSpeed?: number;
	enableZoom?: boolean;
	enablePan?: boolean;
	minDistance?: number;
	maxDistance?: number;
};

/** Infinite distance-fading reference grid. See `createGrid`. */
export type GridConfig = {
	/** Default false (opt-in). */
	enabled?: boolean;
	/** World units (meters). Default 1. */
	cellSize?: number;
	/** Minor cells per major line. Default 10. */
	majorEvery?: number;
	cellColor?: THREE.ColorRepresentation;
	majorColor?: THREE.ColorRepresentation;
	/** World radius at which the grid fully fades. Default 100. */
	fadeDistance?: number;
	/**
	 * Axis the grid lies perpendicular to. Defaults to whichever axis `sceneUp` points along
	 * (`'z'` unless `sceneUp` is overridden); set explicitly to force an orientation that ignores it.
	 */
	plane?: 'x' | 'y' | 'z';
};

/** Corner nav-cube/axis gizmo that snaps to preset views. See `createViewGizmo`. */
export type GizmoConfig = {
	/** Default false (opt-in). */
	enabled?: boolean;
};

/** Two-click distance measurement tool. See `createMeasureTool`. */
export type MeasureConfig = {
	/** Default false. Only builds the tool; start measuring via `measureTool.setEnabled(true)` on the init result. */
	enabled?: boolean;
	/** Snap to a vertex within this many screen px. Default 12. */
	snapPixels?: number;
	/** Default yellow. */
	color?: THREE.ColorRepresentation;
	/** CSS class for the distance label. */
	labelClassName?: string;
	/** Scene is in meters; pass the response's `modelunits` to convert the label (e.g. "25.0 mm"). Default meters. Ignored if `format` is set. */
	displayUnit?: string;
	/** Receives the straight-line `distance` and per-axis `delta`. Default renders the total plus a Δx/Δy/Δz breakdown. */
	format?: (distance: number, delta: THREE.Vector3) => string;
};

export type ThreeInitializerOptions = {
	sceneScale?: 'mm' | 'cm' | 'm' | 'inches' | 'feet';
	/**
	 * Seeds lighting/material defaults (tone mapping, AO, IBL strength, hemisphere fill); explicit
	 * `lighting`/`environment`/`render` options still win. Does NOT touch edges/grid. Default
	 * 'technical'. Re-apply later via the init result's `setLook`.
	 */
	look?: Look;
	camera?: CameraConfig;
	lighting?: LightingConfig;
	environment?: EnvironmentConfig;
	floor?: FloorConfig;
	render?: RenderConfig;
	controls?: ControlsConfig;
	grid?: GridConfig;
	gizmo?: GizmoConfig;
	edges?: EdgesConfig;
	measure?: MeasureConfig;
	events?: EventConfig;
	/**
	 * Called once at init with the GPU's max anisotropy. **Not needed for sharp textures** — the
	 * parse layer's texture cache subscribes to this value itself via a shared sink. This hook is
	 * only for hosts doing their own texture work on top.
	 */
	onMaxAnisotropy?: (value: number) => void;
};

export type EventConfig = {
	onBackgroundClicked?: (event: { x: number; y: number }) => void;
	onObjectSelected?: (object: THREE.Object3D) => void;
	/** Receives the clicked mesh's `userData`; only fires for meshes with non-empty `userData`. */
	onMeshMetadataClicked?: (metadata: Record<string, unknown>) => void;
	onMeshDoubleClicked?: (object: THREE.Object3D) => void;
	/** Default red (#ff0000). */
	selectionColor?: THREE.Color | string;
	/** Enable all event handlers (click/selection/metadata). Default true. */
	enableEventHandlers?: boolean;
	enableKeyboardControls?: boolean;
	enableClickToFocus?: boolean;
	/** Default true. */
	enableDoubleClickZoom?: boolean;
	onReady?: () => void;
	/** Fires every animation frame, after controls update and before render. */
	onFrame?: (delta: number) => void;
};
