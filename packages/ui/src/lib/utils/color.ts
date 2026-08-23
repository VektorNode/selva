// Hex → OKLCH. A non-null input that isn't a 6-digit hex comes back unchanged, so
// callers can pass through CSS colors this function doesn't understand; null gives ''.
export const hexToOklch = (hex: string | null): string => {
	if (!hex) return '';

	const normalized = hex.replace(/^#/, '');

	if (!/^[0-9A-Fa-f]{6}$/.test(normalized)) {
		return hex;
	}

	const r = parseInt(normalized.slice(0, 2), 16) / 255;
	const g = parseInt(normalized.slice(2, 4), 16) / 255;
	const b = parseInt(normalized.slice(4, 6), 16) / 255;

	// sRGB transfer function, inverted: gamma-encoded channel → linear light.
	const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);

	// Linear sRGB → CIE XYZ (D65 white point).
	const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
	const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.072175;
	const z = lr * 0.0193339 + lg * 0.119192 + lb * 0.9503041;

	// XYZ → OKLab: the M1 cone-response matrix, cube root, then the M2 matrix.
	const l_ = Math.cbrt(0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z);
	const m_ = Math.cbrt(0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z);
	const s_ = Math.cbrt(0.0482003018 * x + 0.2643662691 * y + 0.633851707 * z);

	const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
	const b_lab = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

	// OKLab → OKLCH: chroma and hue as polar coordinates of (a, b).
	const C = Math.sqrt(a * a + b_lab * b_lab);
	let H = (Math.atan2(b_lab, a) * 180) / Math.PI;
	if (H < 0) H += 360;

	return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${H.toFixed(1)})`;
};
