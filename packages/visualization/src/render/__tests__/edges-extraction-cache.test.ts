import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { extractSegmentsSync } from '../edges/extraction.js';

describe('edge extraction cache', () => {
	it('reuses the segments of a geometry built on the same arrays', () => {
		const source = new THREE.BoxGeometry(1, 1, 1);
		const rebuilt = new THREE.BufferGeometry();
		rebuilt.setAttribute('position', source.getAttribute('position'));
		rebuilt.setIndex(source.index);

		expect(extractSegmentsSync(rebuilt, 30)).toBe(extractSegmentsSync(source, 30));
		expect(extractSegmentsSync(source, 45)).not.toBe(extractSegmentsSync(source, 30));
	});

	it('extracts again after the positions are edited in place', () => {
		const geometry = new THREE.BoxGeometry(1, 1, 1);
		const before = extractSegmentsSync(geometry, 30);

		const position = geometry.getAttribute('position') as THREE.BufferAttribute;
		position.setX(0, 5);
		position.needsUpdate = true;

		expect(extractSegmentsSync(geometry, 30)).not.toBe(before);
	});
});
