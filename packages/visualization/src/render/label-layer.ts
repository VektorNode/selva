import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

export interface LabelHandle {
	readonly object: CSS2DObject;
	setPosition(position: THREE.Vector3): void;
	setText(text: string): void;
	remove(): void;
}

export interface LabelLayer {
	addLabel(text: string, position: THREE.Vector3, className?: string): LabelHandle;
	/** Call each frame after the WebGL render, with the active camera. */
	render(scene: THREE.Scene, camera: THREE.Camera): void;
	setSize(width: number, height: number): void;
	dispose(): void;
}

// container: overlay is appended here, absolutely positioned — normally the canvas's parent
// so they share a positioning context.
export function createLabelLayer(container: HTMLElement, scene: THREE.Scene): LabelLayer {
	const renderer = new CSS2DRenderer();
	const dom = renderer.domElement;
	dom.style.position = 'absolute';
	dom.style.top = '0';
	dom.style.left = '0';
	// CSS2DRenderer sets width/height in pixels, so percentage sizing can't work — host must call
	// `setSize` on every resize, same as the WebGL renderer.
	// overflow:hidden + pointerEvents:none: without both, the overlay can cover the canvas and
	// swallow orbit/clicks.
	dom.style.overflow = 'hidden';
	dom.style.pointerEvents = 'none';
	dom.style.zIndex = '30'; // above canvas/host overlays, below menus/popovers
	if (getComputedStyle(container).position === 'static') {
		container.style.position = 'relative';
	}
	container.appendChild(dom);

	const size = { width: container.clientWidth || 1, height: container.clientHeight || 1 };
	renderer.setSize(size.width, size.height);

	const group = new THREE.Group(); // 'label-layer' name/id: pick/fit logic in scene/objects.ts skips it
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
			// Inline default so the layer needs no external stylesheet; pass className to opt out.
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
