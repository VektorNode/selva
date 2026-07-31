import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { EdgeDetectionPass, type EdgeDetectionOptions } from './edge-detection-pass';

/**
 * Optional postprocessing pipeline. Default-OFF: only constructed when AO or screen-space edges is
 * enabled; otherwise the viewer renders with plain `renderer.render` so the cheap path stays cheap.
 *
 * Pipeline: RenderPass → GTAOPass? → EdgeDetectionPass? → SMAAPass → OutputPass.
 * - GTAO: modern SSAO/SAO replacement. `screenSpaceRadius` keeps the AO radius scale-robust across
 *   the viewer's mm→m scenes without per-scene tuning.
 * - EdgeDetectionPass: screen-space crease/silhouette lines at O(pixels), the fallback for scenes
 *   too triangle-heavy for geometry edge overlays. Sits before SMAA so its 1px lines get
 *   antialiased. Always constructed (render target is lazy) so {@link RenderPipeline.setEdgeDetection}
 *   can toggle it without a pipeline rebuild.
 * - SMAA: required because EffectComposer renders offscreen, so the renderer's own MSAA does
 *   nothing here — without it, enabling AO would visibly worsen edge quality. Chosen over TAA
 *   because TAA's temporal jitter smears during OrbitControls drags.
 * - OutputPass: applies tone mapping + color space last, so SMAA operates on the pre-tonemapped image.
 *
 * Camera can flip perspective↔ortho at runtime; rather than rebuild the composer, passes' `camera`
 * is retargeted each time via {@link setCamera}.
 */

export interface RenderPipeline {
	render(deltaTime: number): void;
	setSize(width: number, height: number, pixelRatio: number): void;
	/** Call when the camera's projection changes (e.g. perspective↔ortho). */
	setCamera(camera: THREE.Camera): void;
	setEdgeDetection(enabled: boolean): void;
	edgeDetectionEnabled(): boolean;
	dispose(): void;
}

export interface RenderPipelineOptions {
	/** Must mirror the renderer's own tone mapping — OutputPass applies it, not the renderer, once composited. */
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** Default true. */
	ambientOcclusion?: boolean;
	/** AO strength 0–1. Default 1. */
	aoIntensity?: number;
	/**
	 * Cap on device-pixel-ratio for the composer's (AO) buffers — AO is low-frequency so rendering
	 * below display DPR is nearly invisible but far cheaper. Clamps `setSize`'s pixelRatio. Default 1.
	 */
	aoPixelRatio?: number;
	/**
	 * Start with the screen-space edge pass enabled; pass an object to tune it. The pass itself is
	 * always constructed (cheap while disabled) so it can be toggled later via `setEdgeDetection`.
	 */
	edgeDetection?: boolean | EdgeDetectionOptions;
}

export function createRenderPipeline(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	width: number,
	height: number,
	options: RenderPipelineOptions
): RenderPipeline {
	const composer = new EffectComposer(renderer);

	const renderPass = new RenderPass(scene, camera);
	composer.addPass(renderPass);

	let gtaoPass: GTAOPass | null = null;
	if (options.ambientOcclusion ?? true) {
		gtaoPass = new GTAOPass(scene, camera, width, height);
		gtaoPass.blendIntensity = options.aoIntensity ?? 1;
		gtaoPass.updateGtaoMaterial({ screenSpaceRadius: true });
		composer.addPass(gtaoPass);
	}

	const edgeOptions = typeof options.edgeDetection === 'object' ? options.edgeDetection : {};
	const edgePass = new EdgeDetectionPass(scene, camera, width, height, edgeOptions);
	edgePass.enabled = !!options.edgeDetection;
	composer.addPass(edgePass);

	// Restores AA lost via the composer's offscreen target (see header). Sized by composer.setSize.
	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	// Clamp DPR so GTAO buffers don't hit full display resolution (4× pixels on a DPR-2 panel).
	const aoPixelRatioCap = options.aoPixelRatio ?? 1;
	composer.setSize(width, height);

	return {
		render: (deltaTime) => composer.render(deltaTime),
		// composer.setSize propagates the pixel-ratio-multiplied size to every pass; calling
		// pass.setSize(w, h) here again would knock the AO/AA targets back down to logical CSS size.
		setSize: (w, h, pixelRatio) => {
			composer.setPixelRatio(Math.min(pixelRatio, aoPixelRatioCap));
			composer.setSize(w, h);
		},
		setCamera: (cam) => {
			renderPass.camera = cam;
			edgePass.camera = cam;
			if (!gtaoPass) return;
			gtaoPass.camera = cam;
			// GTAOPass bakes camera type into its AO shader as a construction-time define; reassigning
			// `camera` alone leaves the old projection's depth reconstruction active (garbage AO after
			// a perspective⇄ortho toggle). Force a shader recompile when the type actually changes.
			// (No handling needed for near/far/projection — GTAOPass re-reads those from `camera` per
			// frame; EdgeDetectionPass needs none of this either.)
			const isPerspective = (cam as Partial<THREE.PerspectiveCamera>).isPerspectiveCamera ? 1 : 0;
			if (gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== isPerspective) {
				gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPerspective;
				gtaoPass.gtaoMaterial.needsUpdate = true;
			}
		},
		setEdgeDetection: (enabled) => {
			edgePass.enabled = enabled;
		},
		edgeDetectionEnabled: () => edgePass.enabled,
		// composer.dispose() doesn't free passes — dispose explicitly.
		dispose: () => {
			composer.dispose();
			gtaoPass?.dispose();
			edgePass.dispose();
			smaaPass.dispose();
			outputPass.dispose();
		}
	};
}
