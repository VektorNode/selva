/**
 * `scene/` — reads a live `THREE.Scene` (content filtering, layer grouping, visibility, selection)
 * with no DOM; never adds, removes, or disposes content — that stays with `render/`.
 *
 * `createSceneOutliner` composes this layer's parts, so they aren't exported individually; reach
 * them through the outliner (`outliner.visibility`, `.selection`, `.layerGroups()`).
 *
 * @module scene
 */

export { createSceneOutliner, type SceneOutliner, type SceneOutlinerOptions } from './outliner.js';

export type { VisibilityState } from './visibility.js';
export type { SelectionState, SelectionModifiers } from './selection.js';
export { getObjectLabel, getTypeLabel } from './objects.js';

/**
 * Read the injected set in markup (`hidden.has(getTrackingKey(obj))`) rather than calling
 * `outliner.visibility.isHidden(obj)` — the latter is not reactive under Svelte runes.
 */
export { getTrackingKey } from './identity.js';
