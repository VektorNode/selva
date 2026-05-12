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

// POST - Run update script and stream output via Server-Sent Events
export const POST: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');
	// Prefer explicit env var; fall back to finding the repo root from cwd.
	// PM2 may launch from packages/compute-app or the repo root depending on config,
	// so we probe upward until we find scripts/update.sh.
	function findInstallDir(): string {
		let dir = process.cwd();
		for (let i = 0; i < 5; i++) {
			if (existsSync(join(dir, 'scripts', 'update.sh'))) return dir;
			const parent = join(dir, '..');
			if (parent === dir) break;
			dir = parent;
		}
		return process.cwd();
	}
	const installDir = env.INSTALL_DIR || findInstallDir();
	const updateScript = join(installDir, 'scripts', 'update.sh');

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function sendEvent(type: string, data: Record<string, unknown>) {
				const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
				controller.enqueue(encoder.encode(message));
			}

			try {
				// Spawn the update script detached so it survives if PM2 kills
				// this Node process mid-restart, or if the SSE client disconnects.
				// detached:true puts the child in its own process group; unref()
				// stops it from blocking the event loop. stdio is piped so we can
				// stream output while the parent is still alive.
				const child = spawn('bash', [updateScript], {
					cwd: installDir,
					env: { PATH: process.env.PATH, HOME: process.env.HOME },
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
