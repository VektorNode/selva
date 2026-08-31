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
 * Read the injected set in markup (`getMemberKeys(obj).every((k) => hidden.has(k))`) rather than
 * calling `outliner.visibility.isHidden(obj)` — the latter is not reactive under Svelte runes.
 * `getMemberKeys` returns one key per source member for merged meshes, so hiding tracks members.
 */
export { getTrackingKey, getMemberKeys } from './identity.js';
export type { SceneEntry } from './entries.js';
export type { MergedMember } from './identity.js';
