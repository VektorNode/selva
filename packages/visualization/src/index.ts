/**
 * `@selvajs/visualization` — a headless, extensible viewer core.
 *
 * Layers depend downward only: `session → scene → render → parse → shared`. Each layer's barrel is
 * the only cross-layer import surface. See README.md for the full diagram.
 *
 * @module @selvajs/visualization
 */

export * from './shared/index.js';
export * from './parse/index.js';
export * from './render/index.js';
export * from './session/index.js';
