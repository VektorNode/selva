/**
 * `@selvajs/visualization` — a headless, extensible viewer core.
 *
 * Layers depend downward only: `scene → render → parse → shared`. Each layer's barrel is the only
 * cross-layer import surface. See README.md for the full diagram.
 *
 * The solve session used to be a fifth layer here. It is a schema-driven form state machine with
 * nothing to say about meshes, so it moved to `@selvajs/solve/client` — leaving this package as
 * exactly mesh conversion + viewer.
 *
 * @module @selvajs/visualization
 */

export * from './shared/index.js';
export * from './parse/index.js';
export * from './render/index.js';
export * from './scene/index.js';
