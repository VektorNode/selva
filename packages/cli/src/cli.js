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
	'setup-proxy': () => import('./commands/proxy.js').then((m) => m.runSetupProxy),
	'setup-url': () => import('./commands/setup-url.js').then((m) => m.runSetupUrl),
	keys: () => import('./commands/keys.js').then((m) => keysDispatch(m)),
	config: () => import('./commands/config.js').then((m) => m.runConfig)
};

// `selva doctor --help` used to run the full doctor: commands own their argv,
// and only `doctor` reads a flag at all, so every other command silently
// ignored `--help` and did its work. Intercepting here keeps `--help` uniform
// across the whole surface without each command re-implementing it.
const USAGE = {
	init: {
		usage: 'selva init',
		blurb:
			'Reconfigure this deployment. Prompts for the same values as scaffolding\nand rewrites .env; generated secrets are left alone.'
	},
	doctor: {
		usage: 'selva doctor [--fix]',
		blurb:
			'Validate .env, providers, Node engine, pm2 boot persistence, and package\npins. Read-only without --fix.',
		flags: [['--fix', 'Apply the repairs doctor reports as automatic. Prompts before each.']]
	},
	start: { usage: 'selva start', blurb: 'pm2 start ecosystem.config.cjs' },
	stop: { usage: 'selva stop', blurb: 'pm2 stop selva-compute' },
	restart: {
		usage: 'selva restart',
		blurb:
			'pm2 restart selva-compute --update-env. The --update-env is why this\nexists: without it a pm2 restart keeps the old .env in memory.'
	},
	logs: { usage: 'selva logs', blurb: 'pm2 logs selva-compute' },
	update: {
		usage: 'selva update',
		blurb:
			'npm update @selvajs/cli + @selvajs/selva, then restart. Rolls the\ndependency tree back if the install fails.'
	},
	migrate: {
		usage: 'selva migrate [--dry-run | --undo]',
		blurb:
			'Bring package.json, the deployment layout and .env onto the current release.\nRenames old keys and proves every setting keeps its meaning before writing.',
		flags: [
			['--dry-run', 'Show what would change. Writes nothing.'],
			['--undo', 'Restore the newest .env backup.']
		]
	},
	'setup-proxy': {
		usage: 'selva setup-proxy [--domain <fqdn>] [--acme-email <addr>]',
		blurb:
			"Put Caddy in front of the app with a Let's Encrypt certificate. Installs\nCaddy if missing, writes /etc/caddy/Caddyfile, validates, and reloads.\nNeeds sudo; prints the config to apply by hand when it can't escalate.",
		flags: [
			['--domain', 'Domain to serve. Prompts (defaulting to ORIGIN) when omitted.'],
			['--acme-email', "Address Let's Encrypt sends expiry notices to."]
		]
	},
	'setup-url': {
		usage: 'selva setup-url',
		blurb:
			'Print the link that opens /setup with its token. The password form needs it\nto create the first admin; it stops working once an admin exists.'
	},
	config: {
		usage: 'selva config <show [--all] | set KEY=VALUE | unset KEY>',
		blurb:
			'Show what .env sets, what is default and what is wrong; set or unset one\nkey after checking it. Edits only that line and keeps a backup.',
		flags: [['--all', 'show: list every setting, defaults included.']]
	},
	keys: {
		usage: 'selva keys rotate <hmac|at-rest> [--finish | --leaked]',
		blurb:
			'Rotate one secret in .env. The old key stays accepted as <KEY>_PREVIOUS, so\nnothing breaks; --finish drops it later. --leaked drops it at once.',
		flags: [
			['--finish', 'Remove <KEY>_PREVIOUS once the overlap has passed.'],
			['--leaked', 'Replace the key and drop the old one now. Breaks what it signed.']
		]
	}
};

function printCommandHelp(command) {
	const entry = USAGE[command];
	const lines = [pc.bold(entry.usage), '', entry.blurb];
	if (entry.flags) {
		lines.push('', pc.bold('Flags:'));
		for (const [flag, description] of entry.flags) {
			lines.push(`  ${flag.padEnd(22)}${description}`);
		}
	}
	console.log(lines.join('\n'));
}

function keysDispatch(m) {
	return async (argv) => {
		const sub = argv[0];
		if (sub === 'rotate') return m.runKeysRotate(argv.slice(1));
		console.error(`Usage: selva keys rotate <hmac|at-rest> [--finish | --leaked]`);
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

	if (rest.includes('--help') || rest.includes('-h')) {
		printCommandHelp(command);
		return;
	}

	const run = await loader();
	await run(rest);
}

function printHelp() {
	console.log(
		[
			pc.bold('selva') + ' — operate a Selva deployment',
			'',
			pc.bold('Usage:') + '  npx selva <command>',
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
			'  setup-proxy             Install + configure Caddy with TLS for this deployment',
			'  setup-url               Print the link that creates the first admin',
			'  config show|set|unset   What .env sets; change one key safely',
			'  keys rotate <hmac|at-rest>   Rotate a secret; the old one keeps working',
			'',
			pc.dim('`npx selva <command> --help` explains one command.'),
			'',
			pc.bold('Two commands, two jobs:'),
			'  ' + pc.cyan('npx @selvajs/cli <dir>') + '   scaffold a NEW deployment into <dir>',
			'  ' + pc.cyan('npx selva <command>') + '      operate the deployment you are standing in',
			'',
			pc.dim('`npx selva` works in a deployment directory because @selvajs/cli is one of'),
			pc.dim('its dependencies. The package.json scripts (`npm run doctor`, `npm start`)'),
			pc.dim('are thin aliases for the same commands. Outside a deployment directory, npx'),
			pc.dim('resolves `selva` to an unrelated npm package: do not let it install one.')
		].join('\n')
	);
}
