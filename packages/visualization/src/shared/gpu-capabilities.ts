// ============================================================================
// GPU capabilities — published by the renderer, read by whoever needs them
// ============================================================================

/**
 * Lets a renderer publish GPU capabilities (max anisotropy) without `render/` and `parse/` importing
 * each other: the renderer publishes on init, interested parties subscribe.
 */

type AnisotropyObserver = (value: number) => void;

const observers = new Set<AnisotropyObserver>();

// Module load order between layers isn't guaranteed, so a subscriber arriving after init still
// needs the current value rather than waiting for a second renderer to publish.
let maxAnisotropy = 1;

export function publishMaxAnisotropy(value: number): void {
	const next = Math.max(1, value);
	if (next === maxAnisotropy) return;
	maxAnisotropy = next;
	for (const observe of observers) observe(next);
}

/** Fires immediately with the current value (1 until a renderer has reported), then on every change. */
export function observeMaxAnisotropy(observe: AnisotropyObserver): () => void {
	observers.add(observe);
	observe(maxAnisotropy);
	return () => observers.delete(observe);
}
