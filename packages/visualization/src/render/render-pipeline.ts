import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { EdgeDetectionPass, type EdgeDetectionOptions } from './edge-detection-pass';

/**
 * Pipeline: RenderPass → GTAOPass? → EdgeDetectionPass? → SMAAPass → OutputPass. EdgeDetectionPass
 * sits before SMAA so its 1px lines get antialiased. SMAA is required because EffectComposer
 * renders offscreen, so the renderer's own MSAA does nothing here; SMAA over TAA because TAA's
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
	/** DPR cap for the composer's AO buffers; clamps `setSize`'s pixelRatio. Default 1. */
	aoPixelRatio?: number;
	/** Start with the screen-space edge pass enabled; pass an object to tune it. */
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

	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	const aoPixelRatioCap = options.aoPixelRatio ?? 1;
	composer.setSize(width, height);

	return {
		render: (deltaTime) => composer.render(deltaTime),
		// composer.setSize only — calling individual pass.setSize would reset AO/AA targets back to
		// logical CSS size, undoing the pixel-ratio scaling.
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
