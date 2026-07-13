import * as THREE from 'three';

export type CameraConfig = {
	position?: THREE.Vector3;
	fov?: number;
	near?: number;
	far?: number;
	target?: THREE.Vector3;
};

export type LightingConfig = {
	enableSunlight?: boolean;
	sunlightIntensity?: number;
	sunlightPosition?: THREE.Vector3;
	ambientLightColor?: THREE.Color;
	ambientLightIntensity?: number;
	sunlightColor?: THREE.Color | number;
	/**
	 * Add a hemisphere fill light (sky color from above, ground color from below). Unlike the flat
	 * ambient, this gives soft *direction-aware* fill, so downward- and side-facing surfaces never
	 * collapse to black when the HDR's lower hemisphere is dark. The single biggest lever for keeping
	 * results well-lit regardless of which HDR is loaded. Default false (opt-in) — enabling it shifts
	 * the look. See {@link LightingConfig.hemisphereIntensity}.
	 */
	enableHemisphereLight?: boolean;
	/** Hemisphere fill sky color (lights upward-facing surfaces). Default white. */
	hemisphereSkyColor?: THREE.Color | number;
	/** Hemisphere fill ground color (lights downward-facing surfaces). Default a mid grey. */
	hemisphereGroundColor?: THREE.Color | number;
	/** Hemisphere fill strength. Default 0.6. Only applies when {@link LightingConfig.enableHemisphereLight}. */
	hemisphereIntensity?: number;
};

export type EnvironmentConfig = {
	hdrPath?: string;
	backgroundColor?: THREE.Color | string;
	enableEnvironmentLighting?: boolean;
	sceneUp?: THREE.Vector3;
	showEnvironment?: boolean;
	/**
	 * Uniform multiplier on the HDR's image-based lighting contribution (`scene.environmentIntensity`).
	 * Normalizes brightness across HDRs of differing exposure — raise it to lift a dim HDR, lower it to
	 * tame a blown-out one — so the scene doesn't render dim-or-blown purely because of the HDR chosen.
	 * Default 1 (three.js default, unchanged look).
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
	/**
	 * Enable ground-truth ambient occlusion (GTAO) via a postprocessing pipeline. Default false —
	 * turning it on switches rendering from `renderer.render` to an EffectComposer, which costs more.
	 */
	ambientOcclusion?: boolean;
	/** AO strength 0–1 when {@link RenderConfig.ambientOcclusion} is on. Default 1. */
	aoIntensity?: number;
	/**
	 * Device-pixel-ratio cap for the ambient-occlusion postprocessing buffers. AO is low-frequency, so
	 * rendering its buffers below the display DPR is nearly invisible but hugely cheaper — on a Retina
	 * display (DPR 2) full-resolution AO means 4× the pixels through GTAO's per-pixel sample loops,
	 * which can dominate frame time. Default 1 (AO buffers at 1× regardless of display DPR). Raise
	 * toward the display DPR for sharper AO at higher cost; only relevant when AO is enabled.
	 */
	aoPixelRatio?: number;
};

/**
 * A ready-to-go visual look. A `look` is a named bundle of LIGHTING/MATERIAL defaults only — it is
 * deliberately decoupled from the CAD overlays (edges, grid), which are driven independently by
 * {@link EdgesConfig}/{@link GridConfig}. Pick one and the viewer looks professional with zero other
 * config; every individual `lighting`/`environment`/`render` option still overrides the preset. Seeds
 * construction defaults and can be re-applied live via `setLook`.
 *
 * - 'technical' (default): matte, drawing-like — neutral tone mapping, low IBL, no fill. Reads like a
 *   CAD shaded view (Rhino/Onshape).
 * - 'studio': balanced presentation — ACES tone mapping, hemisphere fill + lifted HDR so results are
 *   well-lit regardless of the HDR, without washing colour out. The polished "product shot" look.
 * - 'showcase': punchier presentation — ACES, stronger IBL/fill and a touch more exposure.
 */
export type Look = 'studio' | 'technical' | 'showcase';

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

/** Crisp boundary/crease edge overlays on meshes. See `addEdges`. */
export type EdgesConfig = {
	/** Auto-attach edge overlays to meshes as they load. Default false (opt-in). */
	enabled?: boolean;
	/** Edge color. Default near-black. */
	color?: THREE.ColorRepresentation;
	/** Edge thickness in CSS px. Default 1.5. */
	width?: number;
	/** Crease angle (degrees): keep edges where faces differ by more than this. Default 30. */
	thresholdAngle?: number;
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
	/** Show the grid. Default false (opt-in). */
	enabled?: boolean;
	/** Minor cell size in world units (meters). Default 1. */
	cellSize?: number;
	/** Minor cells per major line. Default 10. */
	majorEvery?: number;
	/** Minor line color. */
	cellColor?: THREE.ColorRepresentation;
	/** Major line color. */
	majorColor?: THREE.ColorRepresentation;
	/** World radius at which the grid fully fades. Default 100. */
	fadeDistance?: number;
	/** Plane the grid lies on. 'y' = horizontal ground. Default 'y'. */
	plane?: 'x' | 'y' | 'z';
};

/** Corner nav-cube/axis gizmo that snaps to preset views. See `createViewGizmo`. */
export type GizmoConfig = {
	/** Show the gizmo. Default false (opt-in). */
	enabled?: boolean;
};

/** Two-click distance measurement tool. See `createMeasureTool`. */
export type MeasureConfig = {
	/**
	 * Create the measurement tool. Default false. Note: this only *builds* the tool (and its label
	 * overlay); start measuring by calling `measureTool.setEnabled(true)` on the init result.
	 */
	enabled?: boolean;
	/** Snap to a vertex within this many screen px. Default 12. */
	snapPixels?: number;
	/** Marker + line color. Default yellow. */
	color?: THREE.ColorRepresentation;
	/** CSS class for the distance label. */
	labelClassName?: string;
	/**
	 * Model unit (pass the response's `modelunits`). The scene is in meters, so the default label is
	 * converted to this unit — a mm model reads "25.0 mm". Defaults to meters. Ignored if `format` is set.
	 */
	displayUnit?: string;
	/**
	 * Format the measurement → label text. Receives the straight-line `distance` and per-axis `delta`.
	 * Default renders the total plus a Δx/Δy/Δz breakdown.
	 */
	format?: (distance: number, delta: THREE.Vector3) => string;
};

export type ThreeInitializerOptions = {
	sceneScale?: 'mm' | 'cm' | 'm' | 'inches' | 'feet';
	/**
	 * Pick a ready-to-go visual look up front — seeds professional lighting/material defaults (tone
	 * mapping, AO, IBL strength, hemisphere fill; see {@link Look}). Individual `lighting`/
	 * `environment`/`render` options still win when set explicitly, so this only fills in what you
	 * leave unspecified. A look does NOT touch edges/grid (those are independent overlays). Defaults
	 * to 'technical'. Re-apply later via the init result's `setLook`.
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
};

export type EventConfig = {
	onBackgroundClicked?: (event: { x: number; y: number }) => void;
	onObjectSelected?: (object: THREE.Object3D) => void;
	/** Called when a mesh with metadata is clicked. Receives the mesh's metadata object. */
	onMeshMetadataClicked?: (metadata: Record<string, string>) => void;
	/** Called when a mesh is double-clicked. Receives the mesh object. */
	onMeshDoubleClicked?: (object: THREE.Object3D) => void;
	/** Color to use for highlighting selected meshes. Defaults to red (#ff0000). */
	selectionColor?: THREE.Color | string;
	/** Enable all event handlers (click/selection/metadata). Defaults to true. */
	enableEventHandlers?: boolean;
	enableKeyboardControls?: boolean;
	enableClickToFocus?: boolean;
	/** Zoom into a mesh on double-click. Defaults to true. */
	enableDoubleClickZoom?: boolean;
	/** Called once the HDR environment map has finished loading and been applied to the scene. */
	onReady?: () => void;
	/** Called every animation frame, after controls update and before render. Use for custom per-frame logic. */
	onFrame?: (delta: number) => void;
};
