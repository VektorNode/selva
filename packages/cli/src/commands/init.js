// `selva init` — reconfigure an existing deployment.
//
// Differences from `create`:
//   • Reads current .env values; uses them as prompt defaults.
//   • Never regenerates SELVA_HMAC_KEY / SELVA_AT_REST_KEY if they're set.
//     Rotating those invalidates sessions and at-rest encryption — that's
//     `selva keys rotate`'s job, not init's.
//   • Doesn't touch package.json or run npm install.

import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig } from '../prompts.js';
import { readEnvFile, writeEnvFile } from '../env.js';
import { generateKey } from '../secrets.js';
import { readEnvTemplate, requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

export async function runInit() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	const envPath = join(dir, '.env');
	const current = readEnvFile(envPath);
	const values = await collectConfig({ defaults: current, mode: 'init' });

	// Preserve secrets. The only safe time to generate them is at install
	// time (no sessions to invalidate, no encrypted data to lose). If the
	// existing .env doesn't have them — which can happen if a previous
	// scaffold bailed mid-flight — generate now and warn.
	if (
		current.SELVA_HMAC_KEY &&
		current.SELVA_HMAC_KEY !== 'replace-this-with-a-random-32-byte-hex-key'
	) {
		values.SELVA_HMAC_KEY = current.SELVA_HMAC_KEY;
	} else {
		values.SELVA_HMAC_KEY = generateKey();
		p.log.warn('SELVA_HMAC_KEY was missing — generated a fresh one.');
	}

	if (
		current.SELVA_AT_REST_KEY &&
		current.SELVA_AT_REST_KEY !== 'replace-this-with-a-random-32-byte-hex-key'
	) {
		values.SELVA_AT_REST_KEY = current.SELVA_AT_REST_KEY;
	} else {
		values.SELVA_AT_REST_KEY = generateKey();
		p.log.warn('SELVA_AT_REST_KEY was missing — generated a fresh one.');
	}

	writeEnvFile(envPath, readEnvTemplate(dir), values);

	p.outro(
		[
			pc.green('Updated ' + pc.cyan(envPath)),
			pc.dim('Restart with: ') + pc.cyan('selva restart')
		].join('\n')
	);
}
