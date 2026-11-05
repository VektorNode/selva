import { composeManifest, defineSetting } from '@selvajs/platform/config';

export const LOCAL_SETTINGS = composeManifest([
	defineSetting({
		key: 'DATA_PATH',
		label: 'Data folder',
		type: 'string',
		required: true,
		onInvalid: 'fail',
		class: 'bootstrap',
		summary: true,
		description: 'Folder on this server holding users, orgs, projects and uploads. Back it up.',
		impact: 'Pointing it elsewhere starts an empty instance; the old data stays where it was.'
	})
]);
