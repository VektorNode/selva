// Rotate SELVA_HMAC_KEY or SELVA_AT_REST_KEY; requires explicit confirm (blast radius in TARGETS).

import { readFileSync, existsSync } from 'node:fs';
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
			pc.red('  • invalidate every share link and pending invite')
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
		'selva',
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
