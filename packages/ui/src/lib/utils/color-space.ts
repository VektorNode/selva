export interface Rgb {
	r: number;
	g: number;
	b: number;
}

/** h in [0, 360), s and v in [0, 1]. */
export interface Hsv {
	h: number;
	s: number;
	v: number;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Accepts `#rgb`, `#rrggbb` and the same without `#`. Returns lowercase `#rrggbb`, or null. */
export function normalizeHex(input: string): string | null {
	const raw = input.trim().replace(/^#/, '');
	if (/^[0-9a-f]{3}$/i.test(raw)) {
		return `#${raw
			.split('')
			.map((c) => c + c)
			.join('')
			.toLowerCase()}`;
	}
	if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
	return null;
}

export function hexToRgb(hex: string): Rgb | null {
	const normalized = normalizeHex(hex);
	if (!normalized) return null;
	return {
		r: parseInt(normalized.slice(1, 3), 16),
		g: parseInt(normalized.slice(3, 5), 16),
		b: parseInt(normalized.slice(5, 7), 16)
	};
}

export function rgbToHex({ r, g, b }: Rgb): string {
	const channel = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
	const rn = r / 255;
	const gn = g / 255;
	const bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const delta = max - Math.min(rn, gn, bn);

	let h = 0;
	if (delta !== 0) {
		if (max === rn) h = ((gn - bn) / delta) % 6;
		else if (max === gn) h = (bn - rn) / delta + 2;
		else h = (rn - gn) / delta + 4;
		h *= 60;
		if (h < 0) h += 360;
	}
	return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
	const c = v * s;
	const hp = (((h % 360) + 360) % 360) / 60;
	const x = c * (1 - Math.abs((hp % 2) - 1));
	const [r1, g1, b1] =
		hp < 1
			? [c, x, 0]
			: hp < 2
				? [x, c, 0]
				: hp < 3
					? [0, c, x]
					: hp < 4
						? [0, x, c]
						: hp < 5
							? [x, 0, c]
							: [c, 0, x];
	const m = v - c;
	return { r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 };
}

export const hexToHsv = (hex: string): Hsv | null => {
	const rgb = hexToRgb(hex);
	return rgb ? rgbToHsv(rgb) : null;
};

export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** WCAG relative luminance of an sRGB color. */
function luminance({ r, g, b }: Rgb): number {
	const lin = (c: number) => {
		const n = c / 255;
		return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
	};
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colors, 1 to 21. Null if either isn't a hex color. */
export function contrastRatio(a: string, b: string): number | null {
	const ra = hexToRgb(a);
	const rb = hexToRgb(b);
	if (!ra || !rb) return null;
	const la = luminance(ra);
	const lb = luminance(rb);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
