// Access-rule input assembly — marshals providers + flags into what
// platform's pure canView/canEdit/… rules consume.

export {
	createProjectAccessInputBuilder,
	type ProjectAccessFlags,
	type ProjectAccessInputBuilder,
	type ProjectAccessInputDeps
} from './project-access-input.js';

// Framework-free permission guards. Redirecting guards stay with the host —
// see the module header in ./guards.ts.
export * from './guards.js';

// Wire-format adapter: the v1 invite body accepts one flat `permissions` array,
// while the stores keep platform and org scope apart.
export { splitFlatPermissions, type SplitPermissions } from './permissions-scope.js';
