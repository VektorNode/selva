/**
 * Re-export shell. The visibility-filtered reads moved to
 * `@selvajs/server/definitions` — they are a tenancy boundary over injected
 * stores, and a second host has to apply the identical rule or it publishes a
 * different API under the same paths.
 *
 * Page loads still import from here; handlers reach the package directly.
 */

export {
	resolveAccessibleProjects,
	listVisibleDefinitions,
	getVisibleDefinition,
	loadVisibleVersion
} from '@selvajs/server/definitions';
export type {
	VisibilityDeps,
	AccessibleProjectSet,
	ListVisibleDefinitionsResult
} from '@selvajs/server/definitions';
