/**
 * `@selvajs/visualization` — a headless, extensible viewer core.
 *
 * Layers depend downward only: `scene → render → parse → shared`. Each layer's barrel is the only
 * cross-layer import surface. See README.md for the full diagram.
 *
 * This root module deliberately re-exports nothing. Import from the layer you need
 * (`@selvajs/visualization/parse`, `/render`, `/scene`) so the layering is enforced by the
 * import graph rather than merely documented. `shared/` is internal; the pieces consumers need
 * (errors, logging, the look vocabulary) are re-exported from `render/`.
 *
 * @module @selvajs/visualization
 */

export {};
