import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { EdgeDetectionPass, type EdgeDetectionOptions } from './edge-detection-pass';

/**
 * Pipeline: RenderPass → GTAOPass? → EdgeDetectionPass? → SMAAPass → OutputPass. EdgeDetectionPass
 * sits before SMAA so its 1px lines get antialiased. EffectComposer renders offscreen, where the
 * canvas's own MSAA never applies, so the scene target carries its own (see {@link msaaSamplesFor});
 * SMAA then smooths what MSAA leaves, the edge pass's lines included. SMAA over TAA because TAA's
 * temporal jitter smears during OrbitControls drags. OutputPass applies tone mapping and color
 * space last, so SMAA operates on the pre-tonemapped image.
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
	/** Must mirror the renderer's own tone mapping — OutputPass applies it once composited, not the renderer. */
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** Default true. */
	ambientOcclusion?: boolean;
	/** AO strength 0–1. Default 1. */
	aoIntensity?: number;
	/** DPR cap for the AO buffers only; the scene itself renders at the full pixel ratio. Default 1. */
	aoPixelRatio?: number;
	/** Start with the screen-space edge pass enabled; pass an object to tune it. */
	edgeDetection?: boolean | EdgeDetectionOptions;
}

/**
 * Without MSAA a sub-pixel feature (a sheet's bright hem edge) comes out as a dashed line, which
 * SMAA can't rebuild. At 2× DPR each CSS pixel already holds four samples, and 4× MSAA on top
 * would cost ~250 MB on a 4K target for no visible gain.
 */
function msaaSamplesFor(pixelRatio: number): number {
	return pixelRatio >= 2 ? 0 : 4;
}

export function createRenderPipeline(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	width: number,
	height: number,
	options: RenderPipelineOptions
): RenderPipeline {
	// Only the first target needs samples: RenderPass draws into it, every later pass is a
	// full-screen quad. EffectComposer clones the second from the first, so reset it.
	const sceneTarget = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
	const composer = new EffectComposer(renderer, sceneTarget);
	composer.renderTarget2.samples = 0;

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

	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	const aoPixelRatioCap = options.aoPixelRatio ?? 1;
	// The composer sizes every pass at the scene's resolution; AO alone is cheap enough to run lower,
	// and its blend samples by UV so it upscales onto the full-resolution frame.
	let aoScale = 1;
	if (gtaoPass) {
		const setAoSize = gtaoPass.setSize.bind(gtaoPass);
		gtaoPass.setSize = (w: number, h: number) =>
			setAoSize(Math.max(1, Math.round(w * aoScale)), Math.max(1, Math.round(h * aoScale)));
	}
	const applyPixelRatio = (pixelRatio: number) => {
		aoScale = Math.min(pixelRatio, aoPixelRatioCap) / pixelRatio;
		const samples = msaaSamplesFor(pixelRatio);
		if (sceneTarget.samples !== samples) {
			sceneTarget.samples = samples;
			sceneTarget.dispose(); // three reallocates on next use; samples alone doesn't trigger it
		}
		composer.setPixelRatio(pixelRatio);
	};
	applyPixelRatio(renderer.getPixelRatio());
	composer.setSize(width, height);

	return {
		render: (deltaTime) => composer.render(deltaTime),
		// composer.setSize only — calling individual pass.setSize would reset AO/AA targets back to
		// logical CSS size, undoing the pixel-ratio scaling.
		setSize: (w, h, pixelRatio) => {
			applyPixelRatio(pixelRatio);
			composer.setSize(w, h);
		},
		setCamera: (cam) => {
			renderPass.camera = cam;
			edgePass.camera = cam;
			if (!gtaoPass) return;
			gtaoPass.camera = cam;
			// GTAOPass bakes camera type into its AO shader as a construction-time define; reassigning
			// `camera` alone leaves the old projection's depth reconstruction active — garbage AO after
			// a perspective⇄ortho toggle. Force a recompile when the type actually changes.
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
		// composer.dispose() doesn't free passes.
		dispose: () => {
			composer.dispose();
			gtaoPass?.dispose();
			edgePass.dispose();
			smaaPass.dispose();
			outputPass.dispose();
		}
	};
}
