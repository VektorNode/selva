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
 * @module scene
 */

export { createSceneOutliner, type SceneOutliner, type SceneOutlinerOptions } from './outliner.js';

export {
	HELPER_IDS,
	isSceneContent,
	getSceneObjects,
	prettyType,
	getObjectLabel,
	getTypeLabel
} from './objects.js';

export { DEFAULT_LAYER, groupByLayer, filterLayerGroups } from './layers.js';

export { getStableKey, getTrackingKey } from './identity.js';

export { createVisibilityState, type VisibilityState } from './visibility.js';

export { createSelectionState, type SelectionState, type SelectionModifiers } from './selection.js';
