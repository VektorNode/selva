import { spawn } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import { actorFrom } from '@selvajs/platform';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/access.server';
import { renderThrown } from '@selvajs/server/logging';
import { checkForUpdate } from '$lib/server/updateCheck.server';
import { readChannel, channelTag } from '$lib/server/releaseChannel.server';
import { getEventSink, getErrorReporter } from '$lib/server/providers.server';
import {
	findDeploymentDir,
	startUpdateOutcomeReconciler,
	updateLogPath,
	updateStatePath,
	type PendingUpdateState
} from '$lib/server/selfUpdate.server';
import {
	readRuntimeVersion,
	buildLauncher,
	buildNpmRunnerScript,
	detectUpdatePlan
} from '$lib/server/updateRunner.server';

// Where the bash wrapper mirrors all script output (`updateLogPath` — in the
// deployment dir so it survives reboots, audit O2). The SSE stream dies the
// moment `pm2 stop selva-compute` succeeds (selva-compute IS the SSE server),
// so the frontend loses visibility into everything that happens after — npm
// update output, pm2 start result, health-probe results, rollback decisions.
// The script keeps writing to this file regardless. Once the new selva-compute
// process is back up, the frontend polls GET on this same route to fetch the
// full log and reveal what happened during the blackout. One log per update —
// the wrapper truncates at start, so we never carry stale content forward.
// The runner's `[EXIT] code=N` marker in the same log also drives the
// post-restart audit-event reconciliation (`selfUpdate.server.ts`).

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

// POST - Run update and stream output via Server-Sent Events.
//
// Runs `npm update @selvajs/*` then restarts via ecosystem.config.cjs. The
// runner script handles stop / update / start / health-probe / rollback with
// an EXIT trap that keeps the app online no matter how it exits.
export const POST: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');

	const channel = readChannel();
	const plan = detectUpdatePlan(env, channel);
	if (!plan) {
		return new Response(
			JSON.stringify({
				error:
					"Couldn't determine how to update this deployment. " +
					'Expected node_modules/@selvajs/selva (CLI scaffold) in the cwd ' +
					'or a parent directory.'
			}),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}

	// Capture the runtime version BEFORE we touch anything, so we can:
	// (a) detect a no-op update and warn, (b) roll back to the prior version
	// if the new process fails to come up healthy.
	const versionBefore = readRuntimeVersion(plan.cwd);
	const actorId = locals.ctx ? actorFrom(locals.ctx) : 'system';

	// Audit trail (O2): `started` now; the terminal event is emitted by the
	// outcome reconciler after the app restarts (this process is killed
	// mid-update). The state file is the reconciler's emission token.
	const pending: PendingUpdateState = {
		startedAt: new Date().toISOString(),
		actorId,
		channel,
		fromVersion: versionBefore
	};
	try {
		writeFileSync(updateStatePath(plan.cwd), JSON.stringify(pending, null, '\t'));
	} catch (err) {
		locals.log.error('Could not persist pending-update state', {
			component: 'selfUpdate',
			err: renderThrown(err)
		});
	}
	await getEventSink().emit({
		type: 'system.update.started',
		channel,
		fromVersion: versionBefore,
		actorId
	});

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function sendEvent(type: string, data: Record<string, unknown>) {
				const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
				controller.enqueue(encoder.encode(message));
			}

			try {
				// Prelude lines are passed to the bash wrapper rather than
				// sendEvent'd directly so they end up in both the SSE stream
				// (via bash stdout) AND the log file (via tee). Without this,
				// the frontend's blackout-recovery file fetch would clobber
				// these lines when it replaces its buffer with the file content.
				const prelude = [
					`[INFO] Updating deployment (cwd: ${plan.cwd}, channel: ${channel})`,
					...(versionBefore ? [`[INFO] Current @selvajs/selva: ${versionBefore}`] : [])
				];

				// Spawn the launcher detached. The launcher writes the actual
				// runner script to disk, daemonizes it (setsid + & + exit),
				// and quits — leaving the runner with PPID=1 so PM2's tree-kill
				// of selva-compute can't reach it. See buildLauncher for the
				// full rationale.
				//
				// The runner is buildNpmRunnerScript — pre-flights the version
				// check, then stop / npm update / start / health probe /
				// rollback, with an EXIT trap that ensures the app is online no
				// matter how the script exits.
				const runnerScript = buildNpmRunnerScript(
					plan.args,
					versionBefore,
					join(plan.cwd, 'ecosystem.config.cjs'),
					channelTag(channel)
				);
				const cmd = 'bash';
				const args = ['-c', buildLauncher(runnerScript, updateLogPath(plan.cwd), prelude)];

				// Prepend the deployment's node_modules/.bin to PATH so the bash
				// script finds the project-local pm2 (and any other tooling
				// installed as a deployment dependency). Without this the script
				// inherits the SvelteKit process's PATH, which on most servers
				// doesn't include node_modules/.bin — so `pm2` resolves to
				// whatever's globally installed, or fails outright if no global
				// pm2 exists. Both are wrong: we want the project-local pm2 so
				// daemon and CLI stay aligned. Mirrors the local-only resolution
				// in @selvajs/cli's pm2Bin().
				const localBin = join(plan.cwd, 'node_modules', '.bin');
				const child = spawn(cmd, args, {
					cwd: plan.cwd,
					env: {
						PATH: `${localBin}:${process.env.PATH ?? ''}`,

						HOME: process.env.HOME,
						INSTALL_DIR: plan.cwd
					},
					detached: true,
					stdio: ['ignore', 'pipe', 'pipe']
				});
				child.unref();

				// Covers the outcomes that DON'T restart this process (pre-flight
				// "already up to date", early failures): this process is still
				// alive to reconcile them. A real update kills this process; the
				// restarted one re-arms the reconciler from hooks.server.ts.
				startUpdateOutcomeReconciler({
					deploymentDir: plan.cwd,
					emit: (e) => getEventSink().emit(e),
					report: (err) => getErrorReporter().capture(err, { tags: { origin: 'selfUpdate' } })
				});

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

// GET — two jobs, selected by query param:
//
//   ?check=1  → query the npm registry and report whether a newer
//               @selvajs/selva is published. JSON: { current, latest,
//               updateAvailable }. The admin page calls this on load to show
//               an "update available" badge. Degrades gracefully: if the
//               registry is unreachable, latest is null and updateAvailable
//               is false (we never block the page on npm).
//
//   (default) → read the tee'd update log so the frontend can recover the
//               chunk of output that happened during the SSE blackout (between
//               `pm2 stop` killing this process and the new selva-compute
//               coming back online). Empty body if no update has run yet.
//               Polled by the admin UI during the post-restart wait.
export const GET: RequestHandler = async ({ locals, url, fetch }) => {
	requirePermission(locals, 'instance_admin');

	if (url.searchParams.get('check') !== null) {
		return json(await checkForUpdate(fetch, readChannel()), {
			headers: { 'Cache-Control': 'no-store' }
		});
	}

	let body = '';
	try {
		body = readFileSync(updateLogPath(findDeploymentDir(env)), 'utf8');
	} catch {
		// Log doesn't exist (no update has run yet). Empty body is correct —
		// the frontend treats no content as "nothing to show yet".
	}
	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
};
