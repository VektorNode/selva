// `selva setup-proxy` — put Caddy in front of the app with a real certificate.
//
// This is the step that separates "pm2 says the app is up" from "someone can
// log in". The app binds 127.0.0.1 only, so without a proxy nothing reaches it;
// and without TLS the session cookie is dropped by the browser, which looks
// exactly like a login that silently fails.
//
// Every privileged action is confirmed once, up front, and routed through
// runPrivileged so a host without sudo gets the exact commands printed instead
// of a half-applied config.

import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import { renderCaddyfile, isServableDomain, originFor } from '../caddyfile.js';
import { escalationHint, escalationMode, runPrivileged } from '../checks/privileged.js';
import { readEnvFile } from '../env.js';

const CADDYFILE_PATH = '/etc/caddy/Caddyfile';

export async function runSetupProxy(argv = []) {
	const dir = process.cwd();
	p.intro(pc.bgCyan(pc.black(' selva setup-proxy ')));

	if (process.platform !== 'linux') {
		p.outro(
			pc.yellow(
				`Caddy setup is automated for Linux/systemd only. On ${process.platform}, ` +
					`copy docs/self-hosting/deployment/Caddyfile.example by hand.`
			)
		);
		return;
	}

	const env = existsSync(join(dir, '.env')) ? readEnvFile(join(dir, '.env')) : {};
	const domain = await resolveDomain(argv, env);
	if (domain === null) return;

	const acmeEmail = await resolveAcmeEmail(argv, env, domain);
	if (acmeEmail === null) return;

	// ORIGIN drives cookie and redirect behaviour. A proxy serving a domain the
	// app doesn't know about produces logins that succeed then bounce, so this
	// is worth stopping for rather than warning about after the fact.
	const expectedOrigin = originFor(domain);
	if (env.ORIGIN && env.ORIGIN !== expectedOrigin) {
		p.log.warn(
			`.env has ORIGIN=${env.ORIGIN}, but this proxy will serve ${expectedOrigin}.\n` +
				`Sessions break when they disagree — update ORIGIN with \`selva init\` ` +
				`(then \`selva restart\`) if the proxy domain is the right one.`
		);
	}

	const caddyfile = renderCaddyfile({ domain, acmeEmail });
	const { mode, reason } = escalationMode();
	if (mode === 'blocked') {
		printManualPath(caddyfile, reason);
		p.outro(pc.yellow('Nothing was changed.'));
		return;
	}

	const existing = readExistingCaddyfile();
	if (existing && existing.trim() !== '' && !existing.includes('reverse_proxy 127.0.0.1')) {
		// Someone else's config. Overwriting it could take an unrelated site
		// offline, and this command has no way to merge two Caddyfiles.
		p.log.warn(`${CADDYFILE_PATH} already exists and doesn't look like a Selva config.`);
		const overwrite = await p.confirm({
			message: `Overwrite ${CADDYFILE_PATH}? The current file is backed up first.`,
			initialValue: false
		});
		if (p.isCancel(overwrite) || !overwrite) {
			printManualPath(caddyfile, null);
			p.outro(pc.yellow('Nothing was changed.'));
			return;
		}
	}

	const proceed = await p.confirm({
		message: `Write ${CADDYFILE_PATH} for ${domain} and reload Caddy? (needs sudo)`,
		initialValue: true
	});
	if (p.isCancel(proceed) || !proceed) {
		p.outro(pc.yellow('Nothing was changed.'));
		return;
	}

	if (!ensureCaddyInstalled()) {
		p.outro(pc.red('Caddy is not installed and could not be installed automatically.'));
		return;
	}

	const s = p.spinner();
	s.start('Writing Caddyfile');
	const staged = stageCaddyfile(caddyfile);
	if (existing) runPrivileged('cp', [CADDYFILE_PATH, `${CADDYFILE_PATH}.bak`]);
	const installed = runPrivileged('cp', [staged, CADDYFILE_PATH]);
	if (!installed.ok) {
		s.stop('Could not write the Caddyfile');
		p.log.error(installed.blocked ? escalationHint(installed.reason) : installed.stderr);
		return;
	}
	s.stop('Caddyfile written');

	// Validate before reload: a bad config leaves the running Caddy untouched,
	// so catching it here means the site never goes down.
	const valid = runPrivileged('caddy', ['validate', '--config', CADDYFILE_PATH]);
	if (!valid.ok) {
		p.log.error('caddy validate rejected the generated config — reverting.');
		if (existing) runPrivileged('cp', [`${CADDYFILE_PATH}.bak`, CADDYFILE_PATH]);
		p.outro(pc.red('Proxy not configured.'));
		return;
	}

	// The Debian package leaves /var/log/caddy root-owned while the service runs
	// as `caddy`; without this the service fails to start on the log directive.
	runPrivileged('mkdir', ['-p', '/var/log/caddy']);
	runPrivileged('chown', ['-R', 'caddy:caddy', '/var/log/caddy']);

	runPrivileged('systemctl', ['enable', 'caddy']);
	const restarted = runPrivileged('systemctl', ['restart', 'caddy']);
	if (!restarted.ok) {
		p.log.error('caddy failed to restart — check `sudo journalctl -u caddy -n 50`.');
		p.outro(pc.red('Proxy configured but not running.'));
		return;
	}

	// Caddy sets X-Forwarded-For on its own, but the app ignores it unless told
	// to trust it — and unset, every request looks like it came from Caddy, so
	// all users share one login rate-limit bucket. Nothing fails visibly, which
	// is why it is said here rather than left to the docs.
	if (!env.ADDRESS_HEADER) {
		p.log.warn(
			`Add these to .env, then \`selva restart\`:\n` +
				pc.cyan('  ADDRESS_HEADER=X-Forwarded-For\n  XFF_DEPTH=1\n') +
				pc.dim(
					'Without them the app sees every request as coming from Caddy, so one\n' +
						'user failing five logins rate-limits everyone. Use XFF_DEPTH=2 if a CDN\n' +
						'or load balancer sits in front of Caddy.'
				)
		);
	}

	p.outro(
		[
			pc.green(`Caddy is serving ${domain}.`),
			pc.dim('A certificate is requested on first request; it needs ') +
				pc.cyan(`${domain} → this host`) +
				pc.dim(' in DNS, and ports 80 + 443 open.'),
			pc.dim('Check it with:  ') + pc.cyan(`curl -sI ${expectedOrigin}/api/health`)
		].join('\n')
	);
}

async function resolveDomain(argv, env) {
	const flag = readFlag(argv, '--domain');
	if (flag) {
		if (isServableDomain(flag)) return flag;
		p.log.error(`--domain ${flag} is not a valid domain name.`);
		return null;
	}

	// ORIGIN is the domain the operator already committed to at scaffold time.
	const fromOrigin = env.ORIGIN?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
	const answer = await p.text({
		message: 'Domain to serve (must already point at this host)',
		placeholder: 'app.example.dev',
		initialValue: fromOrigin && isServableDomain(fromOrigin) ? fromOrigin : '',
		validate: (v) =>
			isServableDomain(v) ? undefined : 'Enter a domain like app.example.dev (no scheme, no port).'
	});
	if (p.isCancel(answer)) {
		p.outro(pc.yellow('Cancelled.'));
		return null;
	}
	return answer.trim();
}

async function resolveAcmeEmail(argv, env, domain) {
	const flag = readFlag(argv, '--acme-email');
	if (flag) return flag;

	const answer = await p.text({
		message: "Email for Let's Encrypt (expiry notices)",
		placeholder: `admin@${domain}`,
		initialValue: env.BOOTSTRAP_INSTANCE_ADMIN_EMAIL ?? '',
		validate: (v) => (v.includes('@') ? undefined : 'Enter an email address.')
	});
	if (p.isCancel(answer)) {
		p.outro(pc.yellow('Cancelled.'));
		return null;
	}
	return answer.trim() || `admin@${domain}`;
}

function readFlag(argv, name) {
	const i = argv.indexOf(name);
	if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) return argv[i + 1].trim();
	const inline = argv.find((a) => a.startsWith(`${name}=`));
	return inline ? inline.slice(name.length + 1).trim() : null;
}

function readExistingCaddyfile() {
	try {
		return readFileSync(CADDYFILE_PATH, 'utf8');
	} catch {
		// Unreadable is the same as absent here: either way there's nothing to
		// preserve, and the write is privileged regardless.
		return null;
	}
}

// Written to a temp file first because the shell redirect that would otherwise
// place it (`echo … | sudo tee`) needs a shell, and passing config text through
// one is how quoting bugs corrupt a file that then fails to validate.
function stageCaddyfile(text) {
	const staged = join(mkdtempSync(join(tmpdir(), 'selva-caddy-')), 'Caddyfile');
	writeFileSync(staged, text, 'utf8');
	return staged;
}

function ensureCaddyInstalled() {
	if (spawnSync('caddy', ['version'], { encoding: 'utf8' }).status === 0) return true;

	p.log.info('Caddy is not installed. Installing from the official apt repository.');
	const steps = [
		[
			'apt-get',
			['install', '-y', 'debian-keyring', 'debian-archive-keyring', 'apt-transport-https', 'curl']
		],
		['apt-get', ['update']],
		['apt-get', ['install', '-y', 'caddy']]
	];
	// The keyring + source-list dance needs a shell pipeline, so it runs as one
	// privileged `sh -c` rather than as spawn args.
	const repo =
		"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && " +
		"curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list";

	const s = p.spinner();
	s.start('Installing Caddy');
	if (!runPrivileged(steps[0][0], steps[0][1]).ok) {
		s.stop('Could not install Caddy prerequisites');
		return false;
	}
	if (!runPrivileged('sh', ['-c', repo]).ok) {
		s.stop('Could not add the Caddy apt repository');
		return false;
	}
	for (const [cmd, args] of steps.slice(1)) {
		if (!runPrivileged(cmd, args).ok) {
			s.stop(`\`${cmd} ${args.join(' ')}\` failed`);
			return false;
		}
	}
	s.stop('Caddy installed');
	return true;
}

function printManualPath(caddyfile, reason) {
	if (reason) p.log.warn(`Cannot escalate — ${escalationHint(reason)}.`);
	p.log.info(
		`Write this to ${CADDYFILE_PATH} yourself, then ` +
			`\`sudo caddy validate --config ${CADDYFILE_PATH} && sudo systemctl restart caddy\`:`
	);
	console.log('\n' + caddyfile);
}
