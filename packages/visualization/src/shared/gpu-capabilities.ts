// ============================================================================
// GPU capabilities — published by the renderer, read by whoever needs them
// ============================================================================

/**
 * Capabilities only a live `WebGLRenderer` can report (e.g. max anisotropy for the texture cache in
 * `parse/`), made available without `render/` and `parse/` importing each other: the renderer
 * publishes on init, interested parties subscribe. Previously this crossed via a host-wired callback
 * (`onMaxAnisotropy`) — a host that forgot it silently got blurry textures.
 */

/** Subscribers notified whenever a renderer reports its capabilities. */
type AnisotropyObserver = (value: number) => void;

const observers = new Set<AnisotropyObserver>();

/**
 * Best max-anisotropy reported by any renderer so far. Kept so a subscriber arriving *after* init
 * (module load order between layers is not guaranteed) still receives the current value rather than
 * waiting for a second viewer.
 */
let maxAnisotropy = 1;

/** Called by `initThree` with `renderer.capabilities.getMaxAnisotropy()`. */
export function publishMaxAnisotropy(value: number): void {
	const next = Math.max(1, value);
	if (next === maxAnisotropy) return;
	maxAnisotropy = next;
	for (const observe of observers) observe(next);
}

/**
 * Observe the GPU's max anisotropy. Fires immediately with the current value (1 until a renderer has
 * reported), then again on every change. Returns an unsubscribe function.
 */
export function observeMaxAnisotropy(observe: AnisotropyObserver): () => void {
	observers.add(observe);
	observe(maxAnisotropy);
	return () => observers.delete(observe);
}
