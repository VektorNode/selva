import type { ThreeViewer } from '@selvajs/visualization/render';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCurveLayer } from '../curve-layer.js';

type Listener = (event?: unknown) => void;

interface FakeElement {
	style: Record<string, string>;
	textContent: string;
	value: string;
	children: FakeElement[];
	addEventListener(type: string, listener: Listener): void;
	fire(type: string, event?: unknown): void;
	appendChild(child: FakeElement): void;
	focus(): void;
	select(): void;
}

function fakeElement(): FakeElement {
	const listeners = new Map<string, Listener>();
	const children: FakeElement[] = [];
	return {
		style: {} as Record<string, string>,
		textContent: '',
		value: '',
		children,
		addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
		fire: (type: string, event: unknown = { stopPropagation() {} }) => listeners.get(type)?.(event),
		appendChild: (child) => children.push(child),
		focus() {},
		select() {}
	};
}

beforeEach(() => {
	vi.stubGlobal('document', { createElement: () => fakeElement() });
});

afterEach(() => vi.unstubAllGlobals());

describe('createCurveLayer labels', () => {
	it('leaves no label behind when disposed while a length is being edited', () => {
		const onScreen = new Set<string>();
		const elements: FakeElement[] = [];
		const viewer = {
			labelLayer: {
				addLabel: (text: string) => {
					const element = fakeElement();
					elements.push(element);
					onScreen.add(text);
					return {
						object: { element },
						setText() {},
						setPosition() {},
						// Chrome blurs a focused field when the element holding it leaves the DOM.
						remove: () => {
							onScreen.delete(text);
							element.children.forEach((child) => child.fire('blur'));
						}
					};
				}
			},
			addUserGeometry() {},
			removeUserGeometry() {},
			invalidate() {}
		} as unknown as ThreeViewer;

		const layer = createCurveLayer({ viewer, id: 'test', metersPerUnit: 0.001 });
		layer.setLabels([{ text: '1450 mm', at: [0, 0, 0], onEdit: () => {} }]);
		elements[0].fire('click');
		layer.dispose();

		expect([...onScreen]).toEqual([]);
	});
});
