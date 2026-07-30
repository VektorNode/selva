/**
 * `scene/` — the bridge between parsed content and what a user sees listed. Reads a live
 * `THREE.Scene` (content filtering, layer grouping, visibility, selection) with no DOM, so an
 * outliner panel, a headless export filter, and a screenshot cropper can share one implementation.
 *
 * It never adds, removes, or disposes content — that stays with `render/`.
 *
 * `createSceneOutliner` composes this layer's parts, so they aren't exported individually; reach
 * them through the outliner (`outliner.visibility`, `.selection`, `.layerGroups()`). The exceptions
 * are the two pure functions a host needs while *rendering* the outliner's output.
 *
 * @module scene
 */

export { createSceneOutliner, type SceneOutliner, type SceneOutlinerOptions } from './outliner.js';

// State handle types, reachable via `outliner.visibility` / `.selection` / `.select()`.
export type { VisibilityState } from './visibility.js';
export type { SelectionState, SelectionModifiers } from './selection.js';

// Display helpers for rendering an outliner row. Pure functions over an object the outliner
// already handed back.
export { getObjectLabel, getTypeLabel } from './objects.js';

/**
 * Keying helper for list rendering. Read the injected set in markup
 * (`hidden.has(getTrackingKey(obj))`) rather than calling `outliner.visibility.isHidden(obj)` —
 * the latter is not reactive under Svelte runes.
 */
export { getTrackingKey } from './identity.js';
