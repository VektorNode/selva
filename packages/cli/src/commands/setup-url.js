// `selva setup-url`: the link that claims an instance with no admin yet.

import { join } from 'node:path';
import pc from 'picocolors';
import { readEnvFile } from '../env.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';
import { setupUrl } from '../generated/config.js';

/** The link for this deployment's `.env`, or an error naming what is missing. */
export function setupUrlFor(env) {
	const key = env.SELVA_HMAC_KEY?.trim();
	if (!key) return { error: 'SELVA_HMAC_KEY is not set in .env. Run `selva doctor`.' };
	const origin = env.ORIGIN?.trim() || `http://localhost:${env.PORT?.trim() || '3000'}`;
	return { url: setupUrl(origin, key) };
}

export async function runSetupUrl() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);
	const result = setupUrlFor(readEnvFile(join(dir, '.env')));
	if (result.error) {
		console.error(pc.red(result.error));
		process.exit(1);
	}
	console.log(
		[
			result.url,
			'',
			pc.dim('Works only while the instance has no admin. Anyone holding it can claim'),
			pc.dim('the instance until then, so do not paste it into a chat or a ticket.')
		].join('\n')
	);
}
