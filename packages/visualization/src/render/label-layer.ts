import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

/**
 * HTML label layer tracking 3D positions via three's {@link CSS2DRenderer} — real DOM nodes (crisp
 * text, CSS-stylable) positioned each frame to follow points in the scene. Backs measurement
 * readouts, dimension annotations, point tags.
 *
 * Draws into its own absolutely-positioned DOM overlay stacked above the WebGL canvas
 * (pointer-events disabled so it never steals clicks). The viewer owns one; features like the
 * measure tool add/remove labels through it.
 */

export interface LabelHandle {
	readonly object: CSS2DObject;
	setPosition(position: THREE.Vector3): void;
	/** Replace the label's text/HTML. */
	setText(text: string): void;
	remove(): void;
}

export interface LabelLayer {
	/** `className` lets callers theme groups of labels. */
	addLabel(text: string, position: THREE.Vector3, className?: string): LabelHandle;
	/** Call each frame after the WebGL render, with the active camera. */
	render(scene: THREE.Scene, camera: THREE.Camera): void;
	setSize(width: number, height: number): void;
	dispose(): void;
}

/**
 * @param container overlay is appended here, absolutely positioned — normally the canvas's parent
 * so they share a positioning context.
 * @param scene labels are parented to a group added to this scene, so they follow the camera
 * without the caller wiring scene-graph parenting.
 */
export function createLabelLayer(container: HTMLElement, scene: THREE.Scene): LabelLayer {
	const renderer = new CSS2DRenderer();
	const dom = renderer.domElement;
	dom.style.position = 'absolute';
	dom.style.top = '0';
	dom.style.left = '0';
	// CSS2DRenderer overwrites width/height in PIXELS and bases its projection math on those same
	// values, so percentage sizing can't work — the host must call `setSize` on every resize, same
	// as for the WebGL renderer. Without the explicit clipped/non-interactive box below, the overlay
	// can cover the canvas and swallow orbit/clicks.
	dom.style.overflow = 'hidden';
	dom.style.pointerEvents = 'none';
	// Above the canvas and host overlays (e.g. loading scrims) sharing this positioning context;
	// below typical menu/popover layers.
	dom.style.zIndex = '30';
	if (getComputedStyle(container).position === 'static') {
		container.style.position = 'relative';
	}
	container.appendChild(dom);

	const size = { width: container.clientWidth || 1, height: container.clientHeight || 1 };
	renderer.setSize(size.width, size.height);

	// Dedicated group: removed en masse on dispose, tagged so pick/fit logic ignores it.
	const group = new THREE.Group();
	group.name = 'label-layer';
	group.userData.id = 'label-layer';
	scene.add(group);

	const labels = new Set<CSS2DObject>();

	const addLabel = (text: string, position: THREE.Vector3, className?: string): LabelHandle => {
		const el = document.createElement('div');
		el.textContent = text;
		if (className) {
			el.className = className;
		} else {
			// Dark translucent pill, legible on any background. Kept inline so the layer needs no
			// external stylesheet; pass className to opt out.
			Object.assign(el.style, {
				padding: '2px 6px',
				borderRadius: '4px',
				background: 'rgba(20, 20, 20, 0.78)',
				color: '#fff',
				font: '12px/1.3 system-ui, sans-serif',
				// `pre` preserves line breaks for multi-line readouts (e.g. total + per-axis deltas).
				whiteSpace: 'pre',
				textAlign: 'center',
				userSelect: 'none'
			} satisfies Partial<CSSStyleDeclaration>);
		}
		el.style.pointerEvents = 'none';

		const object = new CSS2DObject(el);
		object.position.copy(position);
		group.add(object);
		labels.add(object);

		return {
			object,
			setPosition: (p) => object.position.copy(p),
			setText: (t) => {
				el.textContent = t;
			},
			remove: () => {
				object.removeFromParent();
				el.remove();
				labels.delete(object);
			}
		};
	};

	return {
		addLabel,
		render: (scene, camera) => renderer.render(scene, camera),
		setSize: (width, height) => renderer.setSize(width, height),
		dispose: () => {
			labels.forEach((object) => {
				object.removeFromParent();
				(object.element as HTMLElement).remove();
			});
			labels.clear();
			group.removeFromParent();
			dom.remove();
		}
	};
}
