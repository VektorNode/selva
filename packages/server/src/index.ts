/**
 * `@selvajs/server` — transport-agnostic compute/solve server building blocks
 * for apps built on the Selva engine.
 *
 * The compute stack (limits, per-key rate limiting, SSRF guard, input
 * transform) that used to live inside the `@selvajs/selva` app, extracted so a
 * consuming app can reuse it instead of copying it. Everything here is
 * env-injected (no ambient `$env` / `process.env`) and framework-agnostic.
 *
 * The full compute subsurface is also available at `@selvajs/server/compute`.
 */

export * from './compute/index.js';
