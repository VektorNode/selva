import * as THREE from 'three';

import { DEFAULT_LOOK, LOOK_PRESETS } from '../../shared/index.js';
import type { ThreeInitializerOptions } from '../types.js';
import { isoOffset, sunOffset, upToAxis } from '../up-axis.js';

/** Rhino's convention, and the frame all geometry arrives in — see `shared/coordinate-frame.ts`. */
export const defaultUp = new THREE.Vector3(0, 0, 1);

/**
 * Options with every *configuration* section filled in by {@link applyDefaults}. `onMaxAnisotropy`
 * stays optional: it's a caller-supplied hook (there is no meaningful default), not a config value.
 */
export type ResolvedOptions = Required<Omit<ThreeInitializerOptions, 'onMaxAnisotropy'>> &
	Pick<ThreeInitializerOptions, 'onMaxAnisotropy'>;

// Exported for unit testing the option-precedence logic (initThree itself needs a real WebGL canvas).
export function applyDefaults(options: ThreeInitializerOptions): ResolvedOptions {
	const scale = options.sceneScale || 'm';

	// All Rhino geometry is normalized to METERS (1 unit = 1 meter), sceneScale just changes the viewing perspective
	const scaleDefaults = {
		mm: {
			cameraDistance: 20,
			near: 0.1,
			far: 2000,
			floorSize: 100,
			lightDistance: 10,
			lightHeight: 20,
			minDistance: 0.1,
			shadowSize: 100,
			scaleFactor: 1000
		},
		cm: {
			cameraDistance: 20,
			near: 0.1,
			far: 2000,
			floorSize: 100,
			lightDistance: 25,
			lightHeight: 50,
			minDistance: 0.1,
			shadowSize: 100,
			scaleFactor: 100
		},
		m: {
			cameraDistance: 10,
			near: 0.01,
			far: 2000,
			floorSize: 50,
			lightDistance: 25,
			lightHeight: 50,
			minDistance: 0.001,
			shadowSize: 100,
			scaleFactor: 1
		},
		inches: {
			cameraDistance: 15,
			near: 0.1,
			far: 2000,
			floorSize: 80,
			lightDistance: 20,
			lightHeight: 40,
			minDistance: 0.1,
			shadowSize: 80,
			scaleFactor: 39.37
		},
		feet: {
			cameraDistance: 8,
			near: 0.1,
			far: 2000,
			floorSize: 40,
			lightDistance: 15,
			lightHeight: 30,
			minDistance: 0.1,
			shadowSize: 60,
			scaleFactor: 3.28084
		}
	};

	const defaults = scaleDefaults[scale];

	// The chosen look seeds the lighting/material defaults (tone mapping, AO, IBL, fill). It sits BELOW
	// explicit per-field options (those still win) and ABOVE the plain per-field defaults — so it only
	// fills what the caller left unspecified. Always a real preset: the default IS a look ('studio'),
	// so there's no "no look" state to represent. A look never touches edges/grid — those resolve from
	// their own configs below.
	const look = options.look ?? DEFAULT_LOOK;
	const preset = LOOK_PRESETS[look];

	return {
		sceneScale: scale,
		look,
		camera: {
			// Default 3/4 iso: behind-left and ABOVE the model. Derived from the scene up axis rather
			// than a literal Z-up vector, so a Y-up scene gets an overhead iso instead of a
			// below-horizon view.
			// `cameraDistance` was historically a PER-COMPONENT magnitude on a (-d, -d, d) vector, so the
			// effective orbit radius is d*sqrt(3). Preserved exactly so this change reorients the default
			// view without also changing how zoomed-in every scene starts.
			position:
				options.camera?.position ||
				isoOffset(
					options.environment?.sceneUp ?? defaultUp,
					defaults.cameraDistance * Math.sqrt(3)
				),
			fov: options.camera?.fov || 20,
			near: options.camera?.near || defaults.near,
			far: options.camera?.far || defaults.far,
			target: options.camera?.target || new THREE.Vector3(0, 0, 0),
			dynamicNear: options.camera?.dynamicNear ?? true
		},
		lighting: {
			enableSunlight: options.lighting?.enableSunlight ?? true,
			sunlightIntensity: options.lighting?.sunlightIntensity ?? 1,
			// Sun overhead and offset to one side, expressed in the scene basis so it stays overhead in
			// any up convention (a hardcoded +Z height made the sun near-horizontal in a Y-up scene).
			sunlightPosition:
				options.lighting?.sunlightPosition ||
				sunOffset(
					options.environment?.sceneUp ?? defaultUp,
					defaults.lightDistance,
					defaults.lightHeight
				),
			ambientLightColor: options.lighting?.ambientLightColor || new THREE.Color(0x404040),
			// The look sets ambient low across the board — the hemisphere fill + env carry the lift, so
			// flat ambient is only a thin floor keeping shadows off pure black. Explicit option still wins.
			ambientLightIntensity: options.lighting?.ambientLightIntensity ?? preset.ambientIntensity,
			sunlightColor: options.lighting?.sunlightColor || 0xffffff, // Default to white sunlight
			// Direction-aware fill. The look decides whether it's on (a positive hemisphereIntensity is
			// what actually creates the light in setupLighting); an explicit option overrides.
			enableHemisphereLight:
				options.lighting?.enableHemisphereLight ?? preset.hemisphereIntensity > 0,
			hemisphereSkyColor: options.lighting?.hemisphereSkyColor ?? 0xdfe6ff,
			// A slightly warm ground tint reads as bounced light and keeps fill from desaturating colour.
			hemisphereGroundColor: options.lighting?.hemisphereGroundColor ?? 0x6b5f52,
			hemisphereIntensity: options.lighting?.hemisphereIntensity ?? preset.hemisphereIntensity
		},
		environment: {
			hdrPath: options.environment?.hdrPath || '/baseHDR.hdr',
			backgroundColor: options.environment?.backgroundColor || new THREE.Color(0xf0f0f0),
			enableEnvironmentLighting: options.environment?.enableEnvironmentLighting ?? true,
			sceneUp: options.environment?.sceneUp || defaultUp,
			showEnvironment: options.environment?.showEnvironment ?? false,
			environmentIntensity: options.environment?.environmentIntensity ?? preset.environmentIntensity
		},
		floor: {
			enabled: options.floor?.enabled ?? false,
			size: options.floor?.size || defaults.floorSize,
			color: options.floor?.color || new THREE.Color(0x808080),
			roughness: options.floor?.roughness ?? 0.7,
			metalness: options.floor?.metalness ?? 0.0,
			receiveShadow: options.floor?.receiveShadow ?? true
		},
		render: {
			enableShadows: options.render?.enableShadows ?? true,
			shadowMapSize: options.render?.shadowMapSize || 2048,
			antialias: options.render?.antialias ?? true,
			pixelRatio: options.render?.pixelRatio || Math.min(window.devicePixelRatio, 2),
			// ?? not || so an explicit NoToneMapping (=== 0) is honoured rather than falling through.
			toneMapping: options.render?.toneMapping ?? preset.toneMapping,
			toneMappingExposure: options.render?.toneMappingExposure ?? preset.toneMappingExposure,
			preserveDrawingBuffer: options.render?.preserveDrawingBuffer ?? false,
			ambientOcclusion: options.render?.ambientOcclusion ?? preset.ambientOcclusion,
			aoIntensity: options.render?.aoIntensity ?? 1,
			// Cap AO buffers at 1× by default — the biggest lever on GTAO cost on high-DPI displays.
			aoPixelRatio: options.render?.aoPixelRatio ?? 1,
			// On-demand rendering (audit P4): draw only when something changed. Opt-out flag.
			onDemand: options.render?.onDemand ?? true
		},
		controls: {
			enableDamping: options.controls?.enableDamping ?? false,
			dampingFactor: options.controls?.dampingFactor || 0.05,
			autoRotate: options.controls?.autoRotate ?? false,
			autoRotateSpeed: options.controls?.autoRotateSpeed || 0.5,
			enableZoom: options.controls?.enableZoom ?? true,
			enablePan: options.controls?.enablePan ?? true,
			minDistance: options.controls?.minDistance || defaults.minDistance,
			maxDistance: options.controls?.maxDistance || Infinity
		},
		grid: {
			// Defaults mirror createGrid's so the two never drift. Grid is an independent overlay — a
			// look never toggles it.
			enabled: options.grid?.enabled ?? false,
			cellSize: options.grid?.cellSize ?? 1,
			majorEvery: options.grid?.majorEvery ?? 10,
			cellColor: options.grid?.cellColor ?? 0x888888,
			majorColor: options.grid?.majorColor ?? 0x444444,
			fadeDistance: options.grid?.fadeDistance ?? 100,
			// The "ground" plane is the one orthogonal to the scene up axis, so the grid lies under the
			// model regardless of up convention (Z-up Rhino → 'z'; Y-up → 'y'). Explicit `plane` wins.
			plane: options.grid?.plane ?? upToAxis(options.environment?.sceneUp ?? defaultUp)
		},
		gizmo: {
			enabled: options.gizmo?.enabled ?? false
		},
		edges: {
			// Defaults mirror addEdges' so the two never drift. Edges are an independent overlay — a
			// look never toggles them.
			enabled: options.edges?.enabled ?? false,
			// No color default: leaving it undefined lets addEdges derive each mesh's edge color from
			// its own surface material (darkened). Set a color explicitly to force one uniform tint.
			color: options.edges?.color,
			darken: options.edges?.darken,
			width: options.edges?.width ?? 1.5,
			thresholdAngle: options.edges?.thresholdAngle ?? 44,
			distanceFade: options.edges?.distanceFade ?? true
		},
		measure: {
			// Visual defaults live in createMeasureTool; only `enabled` needs a value here, the rest
			// pass through (undefined → the tool's own default).
			enabled: options.measure?.enabled ?? false,
			snapPixels: options.measure?.snapPixels,
			color: options.measure?.color,
			labelClassName: options.measure?.labelClassName,
			displayUnit: options.measure?.displayUnit,
			format: options.measure?.format
		},
		events: {
			onBackgroundClicked: options.events?.onBackgroundClicked,
			onObjectSelected: options.events?.onObjectSelected,
			onMeshMetadataClicked: options.events?.onMeshMetadataClicked,
			onMeshDoubleClicked: options.events?.onMeshDoubleClicked,
			selectionColor: options.events?.selectionColor || '#ff0000', // Default to red
			enableEventHandlers: options.events?.enableEventHandlers ?? true,
			enableKeyboardControls: options.events?.enableKeyboardControls ?? true,
			enableClickToFocus: options.events?.enableClickToFocus ?? true,
			enableDoubleClickZoom: options.events?.enableDoubleClickZoom ?? true,
			onReady: options.events?.onReady,
			onFrame: options.events?.onFrame
		},
		onMaxAnisotropy: options.onMaxAnisotropy
	};
}
