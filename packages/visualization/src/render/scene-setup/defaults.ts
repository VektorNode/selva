import * as THREE from 'three';

import { DEFAULT_LOOK, LOOK_PRESETS } from '../../shared/index.js';
import type { ThreeInitializerOptions } from '../types.js';
import { isoOffset, sunOffset, upToAxis } from '../up-axis.js';

/** Rhino's convention, and the frame all geometry arrives in — see `shared/coordinate-frame.ts`. */
export const defaultUp = new THREE.Vector3(0, 0, 1);

// Every config section filled in by applyDefaults. onMaxAnisotropy stays optional — a caller-supplied
// hook with no meaningful default, not a config value.
export type ResolvedOptions = Required<Omit<ThreeInitializerOptions, 'onMaxAnisotropy'>> &
	Pick<ThreeInitializerOptions, 'onMaxAnisotropy'>;

// Exported for unit testing the option-precedence logic (initThree itself needs a real WebGL canvas).
export function applyDefaults(options: ThreeInitializerOptions): ResolvedOptions {
	const scale = options.sceneScale || 'm';

	// Geometry is always in meters; sceneScale only changes the viewing perspective (camera/light/grid magnitudes).
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

	// The chosen look seeds lighting/material defaults (tone mapping, AO, IBL, fill): below explicit
	// per-field options, above the plain per-field defaults. Never touches edges/grid — those resolve
	// from their own configs below.
	const look = options.look ?? DEFAULT_LOOK;
	const preset = LOOK_PRESETS[look];

	return {
		sceneScale: scale,
		look,
		camera: {
			// Default 3/4 iso (behind-left, above), derived from the scene up axis so a Y-up scene still
			// gets an overhead iso rather than a below-horizon view.
			// cameraDistance was historically a per-component magnitude on a (-d,-d,d) vector (orbit
			// radius d*sqrt(3)) — preserved so switching the derivation doesn't also rezoom every scene.
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
			// Expressed in the scene basis so the sun stays overhead in any up convention (a hardcoded
			// +Z height made it near-horizontal in a Y-up scene).
			sunlightPosition:
				options.lighting?.sunlightPosition ||
				sunOffset(
					options.environment?.sceneUp ?? defaultUp,
					defaults.lightDistance,
					defaults.lightHeight
				),
			ambientLightColor: options.lighting?.ambientLightColor || new THREE.Color(0x404040),
			// Looks keep ambient low; hemisphere fill + env carry the lift, ambient is just a floor
			// against pure black shadows.
			ambientLightIntensity: options.lighting?.ambientLightIntensity ?? preset.ambientIntensity,
			sunlightColor: options.lighting?.sunlightColor || 0xffffff,
			// A positive hemisphereIntensity is what actually creates the light in setupLighting.
			enableHemisphereLight:
				options.lighting?.enableHemisphereLight ?? preset.hemisphereIntensity > 0,
			hemisphereSkyColor: options.lighting?.hemisphereSkyColor ?? 0xdfe6ff,
			// Slightly warm ground tint reads as bounced light, keeps fill from desaturating colour.
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
			// Cap AO buffers at 1x — biggest lever on GTAO cost at high DPI.
			aoPixelRatio: options.render?.aoPixelRatio ?? 1,
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
			// Mirrors createGrid's own defaults so the two never drift. A look never toggles the grid.
			enabled: options.grid?.enabled ?? false,
			cellSize: options.grid?.cellSize ?? 1,
			majorEvery: options.grid?.majorEvery ?? 10,
			cellColor: options.grid?.cellColor ?? 0x888888,
			majorColor: options.grid?.majorColor ?? 0x444444,
			fadeDistance: options.grid?.fadeDistance ?? 100,
			// Ground plane is orthogonal to the scene up axis (Z-up Rhino -> 'z', Y-up -> 'y').
			plane: options.grid?.plane ?? upToAxis(options.environment?.sceneUp ?? defaultUp)
		},
		gizmo: {
			enabled: options.gizmo?.enabled ?? false
		},
		edges: {
			// Mirrors addEdges' own defaults so the two never drift. A look never toggles edges.
			enabled: options.edges?.enabled ?? false,
			// Undefined lets addEdges derive each mesh's edge color from its own surface material
			// (darkened); set explicitly to force one uniform tint.
			color: options.edges?.color,
			darken: options.edges?.darken,
			width: options.edges?.width ?? 1.5,
			thresholdAngle: options.edges?.thresholdAngle ?? 44,
			distanceFade: options.edges?.distanceFade ?? true
		},
		measure: {
			// Visual defaults live in createMeasureTool; the rest pass through undefined to its own defaults.
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
			selectionColor: options.events?.selectionColor || '#ff0000',
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
