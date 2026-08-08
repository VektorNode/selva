// `selva <command>` dispatcher.
//
// Kept deliberately flat — each command is a leaf module that gets imported
// only when its command runs. No global state, no shared parser; commands
// own their own argv handling.

import pc from 'picocolors';

const COMMANDS = {
	init: () => import('./commands/init.js').then((m) => m.runInit),
	doctor: () => import('./commands/doctor.js').then((m) => m.runDoctor),
	start: () => import('./commands/pm2.js').then((m) => m.runStart),
	stop: () => import('./commands/pm2.js').then((m) => m.runStop),
	restart: () => import('./commands/pm2.js').then((m) => m.runRestart),
	logs: () => import('./commands/pm2.js').then((m) => m.runLogs),
	update: () => import('./commands/pm2.js').then((m) => m.runUpdate),
	migrate: () => import('./commands/migrate.js').then((m) => m.runMigrate),
	keys: () => import('./commands/keys.js').then((m) => keysDispatch(m))
};

function keysDispatch(m) {
	return async (argv) => {
		const sub = argv[0];
		if (sub === 'rotate') return m.runKeysRotate(argv.slice(1));
		console.error(`Usage: selva keys rotate <hmac|at-rest>`);
		process.exit(1);
	};
}

export async function runSelva(argv) {
	const [command, ...rest] = argv;
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		printHelp();
		return;
	}

	if (command === '--version' || command === '-v') {
		const { readFileSync } = await import('node:fs');
		const { fileURLToPath } = await import('node:url');
		const { dirname, join } = await import('node:path');
		const here = dirname(fileURLToPath(import.meta.url));
		const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
		console.log(pkg.version);
		return;
	}

	const loader = COMMANDS[command];
	if (!loader) {
		console.error(`${pc.red('✗')} Unknown command: ${command}\n`);
		printHelp();
		process.exit(1);
	}

	const run = await loader();
	await run(rest);
}

function printHelp() {
	console.log(
		[
			pc.bold('selva') + ' — operate a Selva deployment',
			'',
			pc.bold('Commands:'),
			'  init                    Reconfigure this deployment (prompts again)',
			'  doctor [--fix]          Validate env, providers, Node engine, and packages',
			'  start                   pm2 start ecosystem.config.cjs',
			'  stop                    pm2 stop selva-compute',
			'  restart                 pm2 restart selva-compute --update-env',
			'  logs                    pm2 logs selva-compute',
			'  update                  npm update @selvajs/cli + @selvajs/selva, then restart',
			'  migrate                 Bring package.json onto the current layout',
			'  keys rotate <hmac|at-rest>   Rotate a secret in .env (destructive)',
			'',
			pc.dim('To scaffold a new deployment: ') + pc.cyan('npx @selvajs/cli <dir>')
		].join('\n')
	);
}
