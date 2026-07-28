import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { EdgeDetectionPass, type EdgeDetectionOptions } from './edge-detection-pass';

/**
 * Optional postprocessing pipeline. Default-OFF: the viewer only constructs this when a
 * postprocessed feature (ambient occlusion, screen-space edges) is enabled, and otherwise renders
 * with a plain `renderer.render` so the cheap path stays cheap (the chosen tradeoff — see
 * cad-viewer-plan.md).
 *
 * Pipeline: RenderPass → GTAOPass? → EdgeDetectionPass? → SMAAPass → OutputPass. GTAO
 * (ground-truth AO) is the modern replacement for SSAO/SAO — better contact shadows in crevices,
 * the "engineered" depth cue. `screenSpaceRadius` is on so the AO radius is in screen space, which
 * keeps it scale-robust across the viewer's mm→m scenes without per-scene tuning.
 *
 * EdgeDetectionPass draws crease/silhouette lines in screen space at O(pixels) — the fallback for
 * scenes too triangle-heavy for geometry edge overlays (docs/plans/4.edge-overlay-performance.md).
 * It sits before SMAA so its 1px lines get antialiased. Always constructed (its render target is
 * lazy), so it can be toggled at runtime via {@link RenderPipeline.setEdgeDetection} without a
 * pipeline rebuild.
 *
 * SMAA restores antialiasing on this path. The EffectComposer renders into an offscreen target, so
 * the WebGLRenderer's own MSAA (`antialias: true`) does nothing here — without a dedicated AA pass,
 * enabling AO would visibly *worsen* edge quality. SMAA is chosen over TAA because TAA's temporal
 * jitter smears during OrbitControls drags; SMAA is single-frame, cheap, and stable while orbiting.
 *
 * OutputPass applies tone mapping + color space last (taking over the roles the renderer did
 * directly in the non-composer path), so SMAA operates on the pre-tonemapped image as intended.
 *
 * Camera swaps: the active camera can flip perspective↔ortho. Rather than rebuild the composer, we
 * retarget the passes' `camera` each render via {@link setCamera}.
 */

export interface RenderPipeline {
	render(deltaTime: number): void;
	setSize(width: number, height: number, pixelRatio: number): void;
	/** Point the passes at the currently active camera (call when projection changes). */
	setCamera(camera: THREE.Camera): void;
	/** Toggle the screen-space edge pass at runtime (no pipeline rebuild). */
	setEdgeDetection(enabled: boolean): void;
	/** Whether the screen-space edge pass currently runs. */
	edgeDetectionEnabled(): boolean;
	dispose(): void;
}

export interface RenderPipelineOptions {
	/** Tone mapping to apply in OutputPass (mirror the renderer's). */
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** Build the pipeline with the GTAO ambient-occlusion pass. Default true. */
	ambientOcclusion?: boolean;
	/** AO strength 0–1. Default 1. */
	aoIntensity?: number;
	/**
	 * Cap on the device-pixel-ratio used for the composer's (AO) buffers. AO is low-frequency, so
	 * rendering below the display DPR is nearly invisible but far cheaper. `setSize`'s incoming
	 * pixelRatio is clamped to this. Default 1.
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

	// Restore antialiasing lost when rendering through the composer's offscreen target (see header).
	// Sized by composer.setSize below, like every other pass.
	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	// OutputPass owns tone mapping in the composer path; match the renderer's settings.
	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	// Clamp the composer's DPR so GTAO's buffers don't render at the full display resolution (4× the
	// pixels on a DPR-2 Retina panel). AO is low-frequency; a 1× buffer upscales near-invisibly.
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
			// GTAOPass bakes the camera type into its AO shader as a define at construction; merely
			// reassigning `camera` leaves the old projection's depth/view-position reconstruction
			// active (garbage AO after a perspective ⇄ ortho toggle). Refresh the define — and force a
			// shader recompile — whenever the projection type actually changes. Near/far/projection
			// uniforms need no handling here: GTAOPass.render() re-reads them from `camera` per frame.
			// (EdgeDetectionPass needs none of this: it reads camera type + near/far per render.)
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
		// composer.dispose() doesn't free added passes — dispose them explicitly.
		dispose: () => {
			composer.dispose();
			gtaoPass?.dispose();
			edgePass.dispose();
			smaaPass.dispose();
			outputPass.dispose();
		}
	};
}
