import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Optional postprocessing pipeline for ambient occlusion. Default-OFF: the viewer only constructs
 * this when `render.ambientOcclusion` is enabled, and otherwise renders with a plain
 * `renderer.render` so the cheap path stays cheap (the chosen tradeoff — see cad-viewer-plan.md).
 *
 * Pipeline: RenderPass → GTAOPass → SMAAPass → OutputPass. GTAO (ground-truth AO) is the modern
 * replacement for SSAO/SAO — better contact shadows in crevices, the "engineered" depth cue.
 * `screenSpaceRadius` is on so the AO radius is in screen space, which keeps it scale-robust across
 * the viewer's mm→m scenes without per-scene tuning.
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
	dispose(): void;
}

export interface RenderPipelineOptions {
	/** Tone mapping to apply in OutputPass (mirror the renderer's). */
	toneMapping: THREE.ToneMapping;
	toneMappingExposure: number;
	/** AO strength 0–1. Default 1. */
	aoIntensity?: number;
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

	const gtaoPass = new GTAOPass(scene, camera, width, height);
	gtaoPass.blendIntensity = options.aoIntensity ?? 1;
	gtaoPass.updateGtaoMaterial({ screenSpaceRadius: true });
	composer.addPass(gtaoPass);

	// Restore antialiasing lost when rendering through the composer's offscreen target (see header).
	// Sized by composer.setSize below, like every other pass.
	const smaaPass = new SMAAPass();
	composer.addPass(smaaPass);

	const outputPass = new OutputPass();
	composer.addPass(outputPass);

	// OutputPass owns tone mapping in the composer path; match the renderer's settings.
	renderer.toneMapping = options.toneMapping;
	renderer.toneMappingExposure = options.toneMappingExposure;

	composer.setSize(width, height);

	return {
		render: (deltaTime) => composer.render(deltaTime),
		// composer.setSize propagates the pixel-ratio-multiplied size to every pass; calling
		// pass.setSize(w, h) here again would knock the AO/AA targets back down to logical CSS size.
		setSize: (w, h, pixelRatio) => {
			composer.setPixelRatio(pixelRatio);
			composer.setSize(w, h);
		},
		setCamera: (cam) => {
			renderPass.camera = cam;
			gtaoPass.camera = cam;
			// GTAOPass bakes the camera type into its AO shader as a define at construction; merely
			// reassigning `camera` leaves the old projection's depth/view-position reconstruction
			// active (garbage AO after a perspective ⇄ ortho toggle). Refresh the define — and force a
			// shader recompile — whenever the projection type actually changes. Near/far/projection
			// uniforms need no handling here: GTAOPass.render() re-reads them from `camera` per frame.
			const isPerspective = (cam as Partial<THREE.PerspectiveCamera>).isPerspectiveCamera ? 1 : 0;
			if (gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== isPerspective) {
				gtaoPass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = isPerspective;
				gtaoPass.gtaoMaterial.needsUpdate = true;
			}
		},
		// composer.dispose() doesn't free added passes — dispose them explicitly.
		dispose: () => {
			composer.dispose();
			gtaoPass.dispose();
			smaaPass.dispose();
			outputPass.dispose();
		}
	};
}
