/**
 * Re-export shell. Server resolution moved to `@selvajs/server/compute` — it
 * reads one injected store and names no framework, and a second host picking a
 * different server for the same (org, definition) pair would solve against
 * different geometry.
 */

export { resolveServerForOrg, ComputeServerUnconfiguredError } from '@selvajs/server/compute';
