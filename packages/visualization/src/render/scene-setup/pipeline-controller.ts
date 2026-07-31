import * as THREE from 'three';

import { createRenderPipeline, type RenderPipeline } from '../render-pipeline.js';
import type { ResolvedOptions } from './defaults.js';

/**
 * Owns the optional postprocessing composer and the two independent reasons to want one: ambient
 * occlusion (a user/look choice) and the screen-space edge fallback (forced on while meshes over
 * the triangle cap are in the scene). Neither knows about the other, so "is a pipeline wanted, and
 * does it need rebuilding" is reconciled here instead of at each caller.
 */
export interface PipelineController {
	get(): RenderPipeline | null;
	sync(): void;
	/** Dispose and rebuild (if one is wanted) so construction-time options re-apply. */
	rebuild(): void;
	setAmbientOcclusion(enabled: boolean): void;
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
				// Always built disabled; sync() flips it live via setEdgeDetection.
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
