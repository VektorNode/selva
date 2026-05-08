/**
 * Visual helpers shared by the consumer (library) and author (projects)
 * definition card. Pure — no DOM, no randomness.
 */

function hash(str: string): number {
	let h = 0;
	for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
	return Math.abs(h);
}

/**
 * Two stable hues derived from the key. The actual gradient is composed in
 * CSS (`.tool-cover-fallback`) so light/dark modes can pick different
 * saturation + lightness without touching this module.
 */
export function huesFor(key: string): { h1: number; h2: number } {
	const h = hash(key);
	return { h1: h % 360, h2: (h >> 3) % 360 };
}

/** First letter of the name, uppercased. Falls back to '?' for empty names. */
export function monogram(name: string | undefined): string {
	const trimmed = name?.trim() ?? '';
	return trimmed ? trimmed[0].toUpperCase() : '?';
}

/** Compact "2h", "3d", "1w" relative timestamp for card footers. */
export function formatUpdated(iso: string): string {
	const diff = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(diff / 60000);
	if (mins < 60) return `${mins}m`;
	const h = Math.floor(mins / 60);
	if (h < 24) return `${h}h`;
	const d = Math.floor(h / 24);
	if (d < 7) return `${d}d`;
	return `${Math.floor(d / 7)}w`;
}
