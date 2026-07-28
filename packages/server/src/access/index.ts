// Access-rule input assembly — marshals providers + flags into what
// platform's pure canView/canEdit/… rules consume.

export {
	createProjectAccessInputBuilder,
	type ProjectAccessFlags,
	type ProjectAccessInputBuilder,
	type ProjectAccessInputDeps
} from './project-access-input.js';
