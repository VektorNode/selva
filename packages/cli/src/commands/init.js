// `selva init` — reconfigures an existing deployment. Unlike `create`, it reads
// the current .env as prompt defaults and never touches package.json or runs
// npm install.

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

	// Never regenerate an existing key: rotating SELVA_HMAC_KEY or
	// SELVA_AT_REST_KEY invalidates sessions and at-rest encryption — that's
	// `selva keys rotate`'s job, not init's. Missing keys (a scaffold that
	// bailed mid-flight) are the one case it's safe to generate here.
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

	// A values-only rewrite drops anything it isn't handed, and the prompts cover
	// only the vars they ask about — every tuned knob the operator set by hand
	// (BODY_SIZE_LIMIT, COMPUTE_*, LOG_LEVEL, …) lives outside that set. Carry
	// the existing file forward and let the prompt answers win on top.
	writeEnvFile(envPath, readEnvTemplate(dir), { ...current, ...values });

	p.outro(
		[
			pc.green('Updated ' + pc.cyan(envPath)),
			pc.dim('Restart with: ') + pc.cyan('selva restart')
		].join('\n')
	);
}
