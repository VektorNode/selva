// ============================================================================
// GPU capabilities — published by the renderer, read by whoever needs them
// ============================================================================

/**
 * Capabilities that only a live `WebGLRenderer` can report, made available to layers that must not
 * import `render/`.
 *
 * The texture cache is the case that motivates this: anisotropic filtering keeps colour maps sharp
 * at grazing angles, the usable maximum is hardware-defined, and only the renderer can ask. But the
 * cache lives in `parse/`, and `render/` must never import `parse/`. Previously this crossed the gap
 * as a host-wired callback (`onMaxAnisotropy`) — which meant a host that forgot it silently got
 * blurry textures, with nothing to indicate why.
 *
 * Inverted here: the renderer *publishes* on init, and interested parties *subscribe* from their own
 * side. Neither layer imports the other, and nothing depends on the host remembering.
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
