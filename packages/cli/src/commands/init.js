// `selva init` — reconfigures an existing deployment. Unlike `create`, it reads
// the current .env as prompt defaults and never touches package.json or runs
// npm install.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig } from '../prompts.js';
import { parseEnv, seededTemplateDefaults, setEnvValues, writeEnvText } from '../env.js';
import { generateKey } from '../secrets.js';
import { readEnvTemplate, requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

export async function runInit() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	const envPath = join(dir, '.env');
	const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
	const current = parseEnv(text);
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

	// Line-level: keys the prompts don't cover, and the operator's comments, stay as they are.
	// A prompt answered blank means unset, as it did when the file was re-rendered.
	const updates = Object.fromEntries(
		Object.entries(values).map(([k, v]) => [k, v === '' ? undefined : v])
	);
	// A template default missing from .env (BODY_SIZE_LIMIT: unset, every upload
	// 413s at adapter-node's 512 KB) is filled in; one the operator set is kept.
	for (const [k, v] of Object.entries(seededTemplateDefaults(readEnvTemplate(dir)))) {
		if (current[k] === undefined && !(k in updates)) updates[k] = v;
	}
	writeEnvText(envPath, setEnvValues(text, updates));

	p.outro(
		[
			pc.green('Updated ' + pc.cyan(envPath)),
			pc.dim('Restart with: ') + pc.cyan('selva restart')
		].join('\n')
	);
}
