import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync } from 'fs';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/access.server';

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

// Selva runs in two valid shapes:
//
//   git  — a checkout of the monorepo (dev boxes, anyone running from source).
//          Update means: git pull + pnpm install + pnpm build + pm2 restart.
//          Implemented by scripts/update.sh, which only exists in the repo.
//
//   npm  — a CLI-scaffolded deployment (operators, customers). The deployment
//          dir holds a package.json that depends on @selvajs/runtime. Update
//          means: npm update @selvajs/* + pm2 restart. There is no repo.
//
// We probe the cwd upward and pick the first shape we can prove. `scripts/
// update.sh` is the more specific marker (only the monorepo carries it), so
// it wins over `node_modules/@selvajs/runtime` when both somehow coexist.
type UpdatePlan =
	| { mode: 'git'; cwd: string; cmd: string; args: string[] }
	| { mode: 'npm'; cwd: string; cmd: string; args: string[] };

function detectUpdatePlan(): UpdatePlan | null {
	// Honor an explicit override first — useful for development.
	if (env.INSTALL_DIR && existsSync(join(env.INSTALL_DIR, 'scripts', 'update.sh'))) {
		return {
			mode: 'git',
			cwd: env.INSTALL_DIR,
			cmd: 'bash',
			args: [join(env.INSTALL_DIR, 'scripts', 'update.sh')]
		};
	}

	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (existsSync(join(dir, 'scripts', 'update.sh'))) {
			return {
				mode: 'git',
				cwd: dir,
				cmd: 'bash',
				args: [join(dir, 'scripts', 'update.sh')]
			};
		}
		if (existsSync(join(dir, 'node_modules', '@selvajs', 'runtime', 'package.json'))) {
			// All @selvajs/* packages move together — fixing a provider-only bug
			// without bumping the runtime is a supported flow.
			return {
				mode: 'npm',
				cwd: dir,
				cmd: 'npm',
				args: [
					'update',
					'--save',
					'@selvajs/create',
					'@selvajs/runtime',
					'@selvajs/platform',
					'@selvajs/local-provider',
					'@selvajs/supabase-provider',
					'@selvajs/header-auth-provider'
				]
			};
		}
		const parent = join(dir, '..');
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

// POST - Run update and stream output via Server-Sent Events.
//
// In git mode we hand off to scripts/update.sh (which has its own pm2
// restart at the end). In npm mode we run `npm update` and then a separate
// `pm2 restart --update-env` so the new process picks up any .env changes.
export const POST: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');

	const plan = detectUpdatePlan();
	if (!plan) {
		return new Response(
			JSON.stringify({
				error:
					"Couldn't determine how to update this deployment. " +
					'Expected either scripts/update.sh (monorepo) or ' +
					'node_modules/@selvajs/runtime (CLI scaffold) in the cwd or a parent.'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function sendEvent(type: string, data: Record<string, unknown>) {
				const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
				controller.enqueue(encoder.encode(message));
			}

			try {
				sendEvent('log', { data: `[INFO] Update mode: ${plan.mode} (cwd: ${plan.cwd})` });

				// Spawn the update command detached so it survives if PM2 kills
				// this Node process mid-restart, or if the SSE client disconnects.
				// detached:true puts the child in its own process group; unref()
				// stops it from blocking the event loop. stdio is piped so we can
				// stream output while the parent is still alive.
				//
				// In npm mode we wrap the command in a shell that also runs the
				// pm2 restart afterwards — update.sh handles that itself in git mode.
				const cmd = plan.mode === 'git' ? plan.cmd : 'sh';
				const args =
					plan.mode === 'git'
						? plan.args
						: [
								'-c',
								// shell-quote the arg array for the npm command, then chain pm2 restart.
								// The chain uses && so a failed update doesn't trigger a restart with
								// half-installed packages.
								[
									plan.args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' '),
									'&&',
									'pm2 restart selva-compute --update-env'
								].join(' ')
							];

				const child = spawn(cmd, args, {
					cwd: plan.cwd,
					env: {
						PATH: process.env.PATH,
						HOME: process.env.HOME,
						INSTALL_DIR: plan.cwd
					},
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe']
				});
				child.unref();

				// Kill the process if it runs longer than 15 minutes.
				// The child is detached (its own process group), so signal the
				// whole group via negative pid — otherwise descendants (pnpm,
				// node, pm2) outlive the bash wrapper.
				const timeout = setTimeout(
					() => {
						try {
							if (child.pid) process.kill(-child.pid, 'SIGTERM');
						} catch {
							// group already gone — nothing to do
						}
						sendEvent('log', { data: '[FATAL] Update timed out after 15 minutes' });
						sendEvent('exit', { code: -1 });
						controller.close();
					},
					15 * 60 * 1000
				);

				// Stream stdout
				let restarting = false;
				child.stdout.on('data', (data) => {
					const lines = data.toString().split('\n');
					for (const line of lines) {
						const clean = stripAnsi(line).trim();
						if (clean) {
							// Detect both stopProcessId (pm2 restart) and restartProcessId (pm2 reload)
							if (
								!restarting &&
								(clean.includes('Applying action stopProcessId') ||
									clean.includes('Applying action restartProcessId'))
							) {
								restarting = true;
								sendEvent('restarting', { data: clean });
							} else {
								sendEvent('log', { data: clean });
							}
						}
					}
				});

				// Stream stderr
				child.stderr.on('data', (data) => {
					const lines = data.toString().split('\n');
					for (const line of lines) {
						const clean = stripAnsi(line).trim();
						if (clean) {
							sendEvent('log', { data: `[ERROR] ${clean}` });
						}
					}
				});

				// Handle process exit
				child.on('close', (code) => {
					clearTimeout(timeout);
					sendEvent('exit', { code: code ?? -1 });
					controller.close();
				});

				// Handle errors
				child.on('error', (err) => {
					clearTimeout(timeout);
					sendEvent('log', { data: `[FATAL] ${err.message}` });
					sendEvent('exit', { code: -1 });
					controller.close();
				});
			} catch (err) {
				sendEvent('log', { data: `[FATAL] Failed to spawn process: ${err}` });
				sendEvent('exit', { code: -1 });
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
