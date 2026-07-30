/**
 * `scene/` — the bridge between parsed content and what a user sees listed.
 *
 * Presenting a live `THREE.Scene` means answering the same questions every time: which children are
 * actual content, how do they group, what is hidden, what is selected. This layer answers them
 * without a DOM, so an outliner panel, a headless export filter, and a screenshot cropper can share
 * one implementation.
 *
 * Depends on `three` only. It reads the scene graph and toggles `.visible`; adding, removing and
 * disposing content stays with `render/`.
 *
 * `createSceneOutliner` composes this layer's parts — content filtering, layer grouping, visibility
 * and selection state — so those pieces are not exported individually; reach them through the
 * outliner (`outliner.visibility`, `outliner.selection`, `outliner.layerGroups()`). The exceptions
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
