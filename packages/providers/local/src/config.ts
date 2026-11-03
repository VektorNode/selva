import { composeManifest, defineSetting } from '@selvajs/platform/config';

export const LOCAL_SETTINGS = composeManifest([
	defineSetting({
		key: 'DATA_PATH',
		type: 'string',
		required: true,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Directory holding users, orgs, projects and uploaded files.',
		impact: 'Pointing it elsewhere starts an empty instance; the old data stays where it was.'
	})
]);
