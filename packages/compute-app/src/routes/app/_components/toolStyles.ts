/**
 * Deterministic visual helpers for consumer-side tool cards: a hash-to-hue
 * color for the project chip, and a gradient fallback for cards without a
 * cover image. Pure — no DOM, no randomness.
 */

function hash(str: string): number {
	let h = 0;
	for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/** Stable HSL color from any string. Good saturation + lightness for chips. */
export function colorFor(key: string): string {
	const hue = hash(key) % 360;
	return `hsl(${hue}, 55%, 55%)`;
}

/**
 * Two-stop gradient for cover-image fallback. Kept intentionally subtle —
 * low saturation, high lightness — so the card still reads as "empty
 * thumbnail" rather than a loud colored tile.
 */
export function gradientFor(key: string): string {
	const h = hash(key);
	const hue1 = h % 360;
	const hue2 = (h >> 3) % 360;
	return `linear-gradient(135deg, hsl(${hue1}, 18%, 94%), hsl(${hue2}, 14%, 88%))`;
}

/** First letter of the name, uppercased. Falls back to '?' for empty names. */
export function monogram(name: string | undefined): string {
	const trimmed = name?.trim() ?? '';
	return trimmed ? trimmed[0].toUpperCase() : '?';
}

/** Relative timestamp — "2m ago", "3h ago", "5d ago". */
export function formatRelative(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const m = Math.floor(diff / 60_000);
	if (m < 1) return 'just now';
	if (m < 60) return `${m}m ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h}h ago`;
	const d = Math.floor(h / 24);
	return `${d}d ago`;
}
