// `selva keys rotate <hmac|at-rest> [--finish | --leaked]`.
//
// A routine rotation keeps the old key as <KEY>_PREVIOUS, which the app still
// accepts, so nothing breaks. `--finish` drops the previous key once its
// overlap has passed. `--leaked` replaces the key and drops the old one at
// once: that is the destructive path, for a key that must stop working now.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { parseEnv, setEnvValues, writeEnvText } from '../env.js';
import { resolveProviders } from '../checks/config.js';
import { generateKey } from '../secrets.js';
import { PREVIOUS_KEY_DAYS } from '../generated/config.js';
import { requireDeploymentDir, resolveDeploymentDir } from '../paths.js';

const TARGETS = {
	hmac: {
		envVar: 'SELVA_HMAC_KEY',
		leakedBlastRadius: hmacBlastRadius,
		finishNote:
			'The app stops accepting the previous key on its own at SELVA_HMAC_KEY_PREVIOUS_EXPIRES; ' +
			'finishing ends it now. Either way this stops working: MCP clients registered before the ' +
			'rotation (they register again), and share links, invites and API tokens stored under the ' +
			'previous key before tokens were hashed without one. Sessions it signed last 8 hours at most.'
	},
	'at-rest': {
		envVar: 'SELVA_AT_REST_KEY',
		leakedBlastRadius: atRestBlastRadius,
		finishNote:
			'The app re-seals stored API keys under the new key at boot, and stops accepting the previous ' +
			'key at SELVA_AT_REST_KEY_PREVIOUS_EXPIRES. Check that /admin/system shows none left on the ' +
			'previous key before finishing, or they become unreadable.'
	}
};

/** What dropping the old SELVA_HMAC_KEY at once invalidates on this deployment's providers. */
export function hmacBlastRadius(env) {
	const { auth } = resolveProviders(env);
	const lines = [];
	// Only the local provider signs sessions with it: Supabase sessions are
	// Supabase JWTs, and under header auth the proxy owns the session.
	if (auth === 'local') lines.push('log every signed-in user out');
	lines.push(
		'invalidate share links, invites and API tokens created before stored tokens were hashed without a key',
		'disconnect every MCP client (each has to register and sign in again)',
		'fail live solve-event streams of solves already running'
	);
	return lines;
}

export function atRestBlastRadius() {
	return [
		'make the stored Rhino.Compute API keys unreadable',
		'require re-entering each API key at /admin/compute'
	];
}

/** The .env change for each mode, as `setEnvValues` updates. */
export function rotationUpdates(env, envVar, mode, fresh = generateKey(), now = Date.now()) {
	const previousVar = `${envVar}_PREVIOUS`;
	const expiresVar = `${previousVar}_EXPIRES`;
	if (mode === 'finish') return { [previousVar]: undefined, [expiresVar]: undefined };
	if (mode === 'leaked')
		return { [envVar]: fresh, [previousVar]: undefined, [expiresVar]: undefined };
	const expires = new Date(now + PREVIOUS_KEY_DAYS * 86_400_000).toISOString();
	return { [envVar]: fresh, [previousVar]: env[envVar], [expiresVar]: expires };
}

function backupsHolding(dir, value) {
	if (!value) return [];
	return readdirSync(dir)
		.filter((f) => f.startsWith('.env.') && f.endsWith('.bak'))
		.filter((f) => readFileSync(join(dir, f), 'utf8').includes(value));
}

export async function runKeysRotate(argv) {
	const target = argv[0];
	const mode = argv.includes('--finish')
		? 'finish'
		: argv.includes('--leaked')
			? 'leaked'
			: 'rotate';
	if (!target || !(target in TARGETS)) {
		console.error('Usage: selva keys rotate <hmac|at-rest> [--finish | --leaked]');
		process.exit(1);
	}

	const dir = resolveDeploymentDir();
	requireDeploymentDir(dir);

	const { envVar, leakedBlastRadius, finishNote } = TARGETS[target];
	const previousVar = `${envVar}_PREVIOUS`;
	const envPath = join(dir, '.env');
	const text = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
	const env = parseEnv(text);

	p.intro(pc.bgYellow(pc.black(` ${mode === 'rotate' ? 'rotate' : mode} ${envVar} `)));

	if (mode === 'rotate') {
		if (env[previousVar]) {
			p.cancel(
				`${previousVar} is still set from the last rotation. Run \`selva keys rotate ${target} --finish\` first.`
			);
			process.exit(1);
		}
		p.note(
			`The current key moves to ${previousVar}, which the app keeps accepting for ${PREVIOUS_KEY_DAYS} days.\nNothing stops working now. After that it is refused on its own; \`selva keys rotate ${target} --finish\`\nremoves it from .env.`,
			'Safe rotation'
		);
	} else if (mode === 'finish') {
		if (!env[previousVar]) {
			p.outro(pc.dim(`${previousVar} is not set: nothing to finish.`));
			return;
		}
		p.note(finishNote, 'Before you finish');
	} else {
		p.note(
			['This will:', ...leakedBlastRadius(env).map((l) => pc.red(`  • ${l}`))].join('\n'),
			'Blast radius'
		);
	}

	const confirmed = await p.confirm({ message: 'Continue?', initialValue: mode === 'rotate' });
	if (p.isCancel(confirmed) || !confirmed) {
		p.cancel('Cancelled.');
		return;
	}

	writeEnvText(envPath, setEnvValues(text, rotationUpdates(env, envVar, mode)));

	const lines = [pc.green(mode === 'finish' ? `${previousVar} removed.` : `${envVar} rotated.`)];
	if (mode !== 'rotate') {
		const stale = backupsHolding(dir, mode === 'finish' ? env[previousVar] : env[envVar]);
		if (stale.length > 0) {
			lines.push(
				pc.yellow(
					`These backups still hold the old key: ${stale.join(', ')}. Delete them if it leaked.`
				)
			);
		}
	}
	lines.push(pc.dim('Restart the app to apply: ') + pc.cyan('selva restart'));
	p.outro(lines.join('\n'));
}
