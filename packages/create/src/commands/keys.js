// `selva keys rotate <hmac|at-rest>` — generate a fresh secret and write it
// back to .env. Refuses without an explicit confirm; what gets invalidated is
// not subtle.
//
//   hmac     — SELVA_HMAC_KEY (HMAC-SHA256). Rotating logs every user out
//              (cookie sessions stop verifying) and breaks any share-link /
//              invite tokens that fell back to it (only relevant when
//              SHARE_LINK_SECRET / INVITE_TOKEN_SECRET are unset — those have
//              their own rotation cycle).
//
//   at-rest  — SELVA_AT_REST_KEY (AES-256-GCM). The encrypted Rhino.Compute
//              API key in compute.config.json becomes undecryptable. The
//              operator has to re-enter the key at /admin/compute.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readEnvFile, writeEnvFile } from '../env.js';
import { generateKey } from '../secrets.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

const TARGETS = {
	hmac: {
		envVar: 'SELVA_HMAC_KEY',
		warning: [
			'This will:',
			pc.red('  • log every signed-in user out (existing session cookies stop verifying)'),
			pc.red('  • invalidate share-link and invite tokens that fell back to this key'),
			pc.dim('    (only relevant when SHARE_LINK_SECRET / INVITE_TOKEN_SECRET are unset)')
		].join('\n')
	},
	'at-rest': {
		envVar: 'SELVA_AT_REST_KEY',
		warning: [
			'This will:',
			pc.red('  • make the encrypted Rhino.Compute API key undecryptable'),
			pc.red('  • require re-entering the API key at /admin/compute'),
			pc.dim('    (other data is plaintext on disk — only the compute API key is encrypted)')
		].join('\n')
	}
};

export async function runKeysRotate(argv) {
	const target = argv[0];
	if (!target || !(target in TARGETS)) {
		console.error(`Usage: selva keys rotate <hmac|at-rest>`);
		process.exit(1);
	}

	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	const { envVar, warning } = TARGETS[target];
	const envPath = join(dir, '.env');
	const current = readEnvFile(envPath);

	p.intro(pc.bgYellow(pc.black(` rotate ${envVar} `)));
	p.note(warning, 'Blast radius');

	const confirmed = await p.confirm({
		message: `Rotate ${envVar}?`,
		initialValue: false
	});
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	const fresh = generateKey();
	current[envVar] = fresh;

	const templatePath = join(
		dir,
		'node_modules',
		'@selvajs',
		'runtime',
		'templates',
		'.env.example'
	);
	const template = existsSync(templatePath)
		? readFileSync(templatePath, 'utf8')
		: readFileSync(envPath, 'utf8');

	writeEnvFile(envPath, template, current);

	p.outro(
		[
			pc.green(`${envVar} rotated.`),
			pc.dim('Restart the app to apply: ') + pc.cyan('selva restart')
		].join('\n')
	);
}
