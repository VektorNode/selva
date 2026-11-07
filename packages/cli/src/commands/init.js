// `selva init` — reconfigures an existing deployment. Unlike `create`, it reads
// the current .env as prompt defaults and never touches package.json or runs
// npm install.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { collectConfig } from '../prompts.js';
import { parseEnv, seededTemplateDefaults, setEnvValues, writeEnvText } from '../env.js';
import { KEY_PLACEHOLDER, generateKey } from '../secrets.js';
import { readEnvTemplate, requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

/**
 * The root keys init writes back. An existing key is never replaced: rotating
 * SELVA_HMAC_KEY or SELVA_AT_REST_KEY invalidates sessions and at-rest
 * encryption, which is `selva keys rotate`'s job. A missing key (a scaffold
 * that bailed mid-flight) or the template placeholder is safe to generate.
 */
export function rootKeysFor(current, generate = generateKey) {
	const keys = {};
	const generated = [];
	for (const name of ['SELVA_HMAC_KEY', 'SELVA_AT_REST_KEY']) {
		if (current[name] && current[name] !== KEY_PLACEHOLDER) {
			keys[name] = current[name];
		} else {
			keys[name] = generate();
			generated.push(name);
		}
	}
	return { keys, generated };
}

export async function runInit() {
	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	const envPath = join(dir, '.env');
	const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
	const current = parseEnv(text);
	const values = await collectConfig({ defaults: current, mode: 'init' });

	const { keys, generated } = rootKeysFor(current);
	Object.assign(values, keys);
	for (const name of generated) p.log.warn(`${name} was missing — generated a fresh one.`);

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
