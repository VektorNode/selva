import * as THREE from 'three';

import { createRenderPipeline, type RenderPipeline } from '../render-pipeline.js';
import type { ResolvedOptions } from './defaults.js';

/**
 * Owns the optional postprocessing composer and the two independent reasons to want one: ambient
 * occlusion (a user/look choice) and the screen-space edge fallback (forced on while meshes over the
 * triangle cap are in the scene). Neither knows about the other, so the "is a pipeline wanted, and
 * does it need rebuilding" reconciliation lives here rather than being duplicated at each caller.
 */
export interface PipelineController {
	/** The live pipeline, or null when neither AO nor the edge fallback wants one. */
	get(): RenderPipeline | null;
	/** Reconcile with what's wanted: AO presence is baked at construction, edges toggle live. */
	sync(): void;
	/** Dispose and rebuild (if one is wanted) so construction-time options re-apply. */
	rebuild(): void;
	setAmbientOcclusion(enabled: boolean): void;
	/** Turn the screen-space fallback on/off. No-op when already in that state. */
	setEdgeFallback(active: boolean): void;
	isEdgeFallbackActive(): boolean;
	dispose(): void;
}

export function createPipelineController(params: {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	getActiveCamera: () => THREE.Camera;
	getCanvasSize: () => { width: number; height: number };
	pixelRatio: number;
	config: ResolvedOptions;
	requestRender: () => void;
}): PipelineController {
	const { renderer, scene, getActiveCamera, getCanvasSize, pixelRatio, config, requestRender } =
		params;

	let pipeline: RenderPipeline | null = null;
	let aoEnabled = !!config.render.ambientOcclusion;
	// True while meshes over the edge triangle cap are in the scene and the config wants the
	// screen-space approximation for them (see EdgesConfig.screenSpaceFallback).
	let edgeFallbackActive = false;
	let builtWithAo = false;

	const build = (withAo: boolean): RenderPipeline => {
		const { width, height } = getCanvasSize();
		const built = createRenderPipeline(
			renderer,
			scene,
			getActiveCamera(),
			Math.max(1, width),
			Math.max(1, height),
			{
				toneMapping: config.render.toneMapping ?? THREE.NeutralToneMapping,
				toneMappingExposure: config.render.toneMappingExposure ?? 1,
				ambientOcclusion: withAo,
				aoIntensity: config.render.aoIntensity,
				aoPixelRatio: config.render.aoPixelRatio,
				// Constructed disabled (cheap until toggled); sync flips it via setEdgeDetection.
				edgeDetection: false
			}
		);
		built.setSize(Math.max(1, width), Math.max(1, height), pixelRatio);
		return built;
	};

	const sync = () => {
		const wantPipeline = aoEnabled || edgeFallbackActive;
		if (!wantPipeline) {
			pipeline?.dispose();
			pipeline = null;
			requestRender();
			return;
		}
		if (!pipeline || builtWithAo !== aoEnabled) {
			pipeline?.dispose();
			pipeline = build(aoEnabled);
			builtWithAo = aoEnabled;
		}
		pipeline.setEdgeDetection(edgeFallbackActive);
		requestRender();
	};

	return {
		get: () => pipeline,
		sync,
		rebuild: () => {
			pipeline?.dispose();
			pipeline = null;
			sync();
		},
		setAmbientOcclusion: (enabled: boolean) => {
			aoEnabled = enabled;
			sync();
		},
		setEdgeFallback: (active: boolean) => {
			if (active === edgeFallbackActive) return;
			edgeFallbackActive = active;
			sync();
		},
		isEdgeFallbackActive: () => edgeFallbackActive,
		dispose: () => {
			pipeline?.dispose();
			pipeline = null;
		}
	};
}
