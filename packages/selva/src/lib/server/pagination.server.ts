/**
 * Re-export shell. The pagination contract moved to `@selvajs/server/api` —
 * parsing a query string names no framework, and a host that isn't SvelteKit
 * needs the same clamping to publish the same contract.
 */

export { parseListOptions, parseDefinitionListOptions } from '@selvajs/server/api';
