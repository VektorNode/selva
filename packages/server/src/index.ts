/**
 * `@selvajs/server` — transport-agnostic compute/solve server building blocks
 * for apps built on the Selva engine.
 *
 * The compute stack (limits, per-key rate limiting, SSRF guard, input
 * transform) that used to live inside the `@selvajs/selva` app, extracted so a
 * consuming app can reuse it instead of copying it. Everything here is
 * env-injected (no ambient `$env` / `process.env`) and framework-agnostic.
 *
 * The full compute subsurface is also available at `@selvajs/server/compute`,
 * the definitions slice (DefinitionService, schema extraction/validation,
 * render loader) at `@selvajs/server/definitions`, the provider wiring
 * (registry-driven `createSelvaProviders`) at `@selvajs/server/providers`,
 * the HMAC token codec at `@selvajs/server/tokens`, error reporting at
 * `@selvajs/server/errors`, and HTTP hardening helpers at
 * `@selvajs/server/http`.
 */

export * from './compute/index.js';
export * from './definitions/index.js';
export * from './providers/index.js';
export * from './tokens/index.js';
export * from './errors/index.js';
export * from './http/index.js';
