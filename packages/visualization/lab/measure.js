import * as THREE from 'three';

// Numbers per object from a finished frame, so a look change can be judged by more than eye.
// An ID pass draws every solve mesh in a flat colour of its own; each pixel of the frame then
// counts toward the object under it. Objects are grouped by name, so a recording merged by
// material reports per material.

/** A display channel at or above this is blown out. */
const CLIPPED = 250;
/** Below this display luma a surface reads as black: its colour and form are gone. */
const CRUSHED = 0.03;
/** Fewer pixels than this and an object's numbers are noise. */
const MIN_PIXELS = 50;

// Display-referred: what the eye sees on the finished image, not the light in the scene.
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

const round = (value, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const percentile = (sorted, share) =>
	sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];

async function decode(blob, width, height) {
	const bitmap = await createImageBitmap(blob);
	const canvas = new OffscreenCanvas(width, height);
	const context = canvas.getContext('2d');
	context.drawImage(bitmap, 0, 0, width, height);
	return context.getImageData(0, 0, width, height).data;
}

// Unlit flat colours into a target without MSAA, so a pixel is exactly one object's id and never a
// blend of two at an edge.
function renderIds(scene, camera, renderer, width, height) {
	const names = [];
	const ids = new Map();
	const swapped = [];
	const hidden = [];
	scene.traverse((object) => {
		const drawable = object.isMesh || object.isLine || object.isPoints || object.isSprite;
		if (!drawable) return;
		if (!object.isMesh || object.userData.source !== 'compute') {
			if (object.visible) hidden.push(object);
			return;
		}
		const name = object.userData.name || object.name || 'unnamed';
		if (!ids.has(name)) {
			names.push(name);
			ids.set(name, names.length);
		}
		const id = ids.get(name);
		const color = new THREE.Color().setRGB(
			(id & 0xff) / 255,
			((id >> 8) & 0xff) / 255,
			((id >> 16) & 0xff) / 255,
			THREE.LinearSRGBColorSpace
		);
		swapped.push([object, object.material]);
		object.material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
	});
	for (const object of hidden) object.visible = false;

	const target = new THREE.WebGLRenderTarget(width, height, {
		samples: 0,
		minFilter: THREE.NearestFilter,
		magFilter: THREE.NearestFilter
	});
	const background = scene.background;
	const toneMapping = renderer.toneMapping;
	scene.background = new THREE.Color(0, 0, 0);
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.setRenderTarget(target);
	renderer.clear();
	renderer.render(scene, camera);
	const pixels = new Uint8Array(width * height * 4);
	renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels);
	renderer.setRenderTarget(null);
	renderer.toneMapping = toneMapping;
	scene.background = background;
	target.dispose();

	for (const [object, material] of swapped) {
		object.material.dispose();
		object.material = material;
	}
	for (const object of hidden) object.visible = true;

	// GL rows run bottom-up, the image's top-down.
	const idAt = new Uint32Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const at = ((height - 1 - y) * width + x) * 4;
			idAt[y * width + x] = pixels[at] | (pixels[at + 1] << 8) | (pixels[at + 2] << 16);
		}
	}
	return { names, idAt };
}

/**
 * Per object: how bright it reads (mean, p10, p90 luma), how much of it is blown out or crushed
 * to black, and its mean colour. Edge pixels are skipped: there the frame's antialiasing blends
 * two objects that the ID pass keeps apart.
 */
export async function measure({ scene, camera, renderer }, blob) {
	const { width, height } = renderer.getDrawingBufferSize(new THREE.Vector2());
	const image = await decode(blob, width, height);
	const { names, idAt } = renderIds(scene, camera, renderer, width, height);

	const groups = names.map(() => ({ lumas: [], clipped: 0, crushed: 0, r: 0, g: 0, b: 0 }));
	const all = { lumas: [], clipped: 0, crushed: 0 };
	for (let y = 1; y < height - 1; y++) {
		for (let x = 1; x < width - 1; x++) {
			const i = y * width + x;
			const id = idAt[i];
			if (id === 0 || id > names.length) continue;
			if (
				idAt[i - 1] !== id ||
				idAt[i + 1] !== id ||
				idAt[i - width] !== id ||
				idAt[i + width] !== id
			) {
				continue;
			}
			const at = i * 4;
			const [r, g, b] = [image[at], image[at + 1], image[at + 2]];
			const value = luma(r, g, b);
			const clipped = Math.max(r, g, b) >= CLIPPED;
			const crushed = value < CRUSHED;
			for (const group of [groups[id - 1], all]) {
				group.lumas.push(value);
				if (clipped) group.clipped++;
				if (crushed) group.crushed++;
			}
			const group = groups[id - 1];
			group.r += r;
			group.g += g;
			group.b += b;
		}
	}

	const summarise = ({ lumas, clipped, crushed }) => {
		const sorted = Float32Array.from(lumas).sort();
		const mean = lumas.reduce((sum, value) => sum + value, 0) / lumas.length;
		return {
			pixels: lumas.length,
			mean: round(mean),
			p10: round(percentile(sorted, 0.1)),
			p90: round(percentile(sorted, 0.9)),
			clippedPercent: round((clipped / lumas.length) * 100, 1),
			crushedPercent: round((crushed / lumas.length) * 100, 1)
		};
	};
	const hex = (value) => Math.round(value).toString(16).padStart(2, '0');

	const objects = {};
	names.forEach((name, index) => {
		const group = groups[index];
		if (group.lumas.length < MIN_PIXELS) return;
		const n = group.lumas.length;
		objects[name] = {
			...summarise(group),
			color: `#${hex(group.r / n)}${hex(group.g / n)}${hex(group.b / n)}`
		};
	});
	return { frame: all.lumas.length ? summarise(all) : null, objects };
}
