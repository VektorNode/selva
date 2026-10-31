import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

import { getHiddenMembers } from '../../shared/index.js';

import { membersOf } from './merged-picking.js';

// ============================================================================
// Hover outline: a silhouette drawn over the finished frame
// ============================================================================
//
// A tint disappears on an object already close to the tint color; a silhouette reads on any
// surface and leaves the object's own color alone. It draws straight to the canvas after the frame
// is done, so it needs no composer (several looks run without one) and skips tone mapping. It
// ignores depth on purpose: an object behind another one is exactly the one worth finding.

/** Also the tint for what has no surface to outline. Distinct from the selection color. */
export const HOVER_COLOR = '#f5a524';
/** CSS pixels. */
const OUTLINE_WIDTH = 2;

const OUTLINE_SHADER = {
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4(position.xy, 0.0, 1.0);
		}
	`,
	// Dilates the mask: a pixel outside the silhouette takes the strongest mask value on two rings
	// around it. The inner ring catches corners sharper than the gap between outer samples.
	fragmentShader: /* glsl */ `
		uniform sampler2D tMask;
		uniform vec2 uTexel;
		uniform float uRadius;
		uniform vec3 uColor;
		varying vec2 vUv;

		const int DIRECTIONS = 16;
		const float TAU = 6.2831853;

		void main() {
			if (texture2D(tMask, vUv).r > 0.5) discard;

			float coverage = 0.0;
			for (int i = 0; i < DIRECTIONS; i++) {
				float angle = TAU * float(i) / float(DIRECTIONS);
				vec2 offset = vec2(cos(angle), sin(angle)) * uRadius * uTexel;
				coverage = max(coverage, texture2D(tMask, vUv + offset).r);
				coverage = max(coverage, texture2D(tMask, vUv + offset * 0.5).r);
			}
			if (coverage <= 0.0) discard;
			gl_FragColor = vec4(uColor, coverage);
		}
	`
};

export interface HoverOutline {
	/**
	 * Outlines a mesh, or one member of a merged mesh; null clears it. False for what has no surface
	 * to outline (lines, points, instanced draws), which the caller marks some other way.
	 */
	show(object: THREE.Object3D | null, memberIndex: number | null): boolean;
	/** Call last in the frame, onto the canvas. */
	render(camera: THREE.Camera): void;
	dispose(): void;
}

/** Curves are instanced quads (`Line2`), so their position attribute isn't their shape. */
function hasPlainSurface(object: THREE.Object3D): object is THREE.Mesh {
	return (
		object instanceof THREE.Mesh &&
		!(object instanceof THREE.InstancedMesh) &&
		!(object.geometry as Partial<THREE.InstancedBufferGeometry>).isInstancedBufferGeometry
	);
}

export function createHoverOutline(renderer: THREE.WebGLRenderer): HoverOutline {
	// One geometry reused for every hover. It borrows the source's buffers, and disposing a borrower
	// frees them, so a fresh geometry per hover would re-upload the source each time.
	const geometry = new THREE.BufferGeometry();
	const maskMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
	const proxy = new THREE.Mesh(geometry, maskMaterial);
	proxy.frustumCulled = false; // no bounds: it borrows attributes and draws a sub-range
	proxy.matrixWorldAutoUpdate = false; // parentless, and `render` would rebuild it from `matrix`

	const mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
	const outlineMaterial = new THREE.ShaderMaterial({
		...OUTLINE_SHADER,
		uniforms: {
			tMask: { value: mask.texture },
			uTexel: { value: new THREE.Vector2() },
			uRadius: { value: 1 },
			// Display-referred: this writes straight to the canvas, past the color-space conversion.
			uColor: { value: new THREE.Color(HOVER_COLOR).convertLinearToSRGB() }
		},
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	});
	const quad = new FullScreenQuad(outlineMaterial);

	let source: THREE.Mesh | null = null;
	let sourceMember: number | null = null;

	const size = new THREE.Vector2();
	const clearColor = new THREE.Color();

	const clear = () => {
		source = null;
		sourceMember = null;
		geometry.deleteAttribute('position');
		geometry.setIndex(null);
	};

	const show: HoverOutline['show'] = (object, memberIndex) => {
		clear();
		if (!object || !hasPlainSurface(object)) return false;

		const position = object.geometry.getAttribute('position');
		if (!position) return false;

		if (memberIndex === null) {
			geometry.setDrawRange(0, Infinity);
		} else {
			const member = membersOf(object)?.[memberIndex];
			if (member?.indexStart == null || member.indexCount == null) return false;
			geometry.setDrawRange(member.indexStart, member.indexCount);
		}

		geometry.setAttribute('position', position);
		geometry.setIndex(object.geometry.getIndex());
		object.updateWorldMatrix(true, false);
		proxy.matrixWorld.copy(object.matrixWorld);
		source = object;
		sourceMember = memberIndex;
		return true;
	};

	// Checked per frame: the eye on a hovered row hides the object while the pointer stays on it.
	const isDrawn = () => {
		if (!source?.visible) return false;
		return sourceMember === null || !getHiddenMembers(source).has(sourceMember);
	};

	const render = (camera: THREE.Camera) => {
		if (!isDrawn()) return;

		renderer.getDrawingBufferSize(size);
		mask.setSize(size.x, size.y);
		outlineMaterial.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
		outlineMaterial.uniforms.uRadius.value = OUTLINE_WIDTH * renderer.getPixelRatio();

		const autoClear = renderer.autoClear;
		const clearAlpha = renderer.getClearAlpha();
		renderer.getClearColor(clearColor);

		renderer.setRenderTarget(mask);
		renderer.setClearColor(0x000000, 0);
		renderer.clear();
		renderer.autoClear = false;
		renderer.render(proxy, camera);
		renderer.setRenderTarget(null);
		renderer.setClearColor(clearColor, clearAlpha);

		quad.render(renderer);
		renderer.autoClear = autoClear;
	};

	return {
		show,
		render,
		dispose: () => {
			clear();
			geometry.dispose();
			maskMaterial.dispose();
			outlineMaterial.dispose();
			quad.dispose();
			mask.dispose();
		}
	};
}
