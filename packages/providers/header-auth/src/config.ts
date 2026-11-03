import { composeManifest, defineSetting } from '@selvajs/platform/config';

const header = (key: string, fallback: string, slot: string) =>
	defineSetting({
		key,
		type: 'string',
		default: fallback,
		onInvalid: 'fail',
		class: 'bootstrap',
		description: `Header the proxy puts the user's ${slot} in.`,
		impact: 'A name the proxy never sends signs nobody in. Override all three or none.'
	});

export const HEADER_AUTH_SETTINGS = composeManifest([
	defineSetting({
		key: 'HEADER_AUTH_DATA_DIR',
		type: 'string',
		onInvalid: 'fail',
		class: 'bootstrap',
		description: 'Directory holding header-allowlist.json. Falls back to DATA_PATH.'
	}),
	header('HEADER_AUTH_UPN_HEADER', 'SELVA-UserPrincipalName', 'UPN'),
	header('HEADER_AUTH_EMAIL_HEADER', 'SELVA-Email', 'email'),
	header('HEADER_AUTH_DISPLAY_NAME_HEADER', 'SELVA-DisplayName', 'display name')
]);
