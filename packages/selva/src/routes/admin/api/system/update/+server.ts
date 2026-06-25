import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { env } from '$env/dynamic/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requirePermission } from '$lib/server/access.server';
import { checkForUpdate } from '$lib/server/updateCheck.server';
import { readChannel, channelTag, type ReleaseChannel } from '$lib/server/releaseChannel.server';

// Where the bash wrapper mirrors all script output. The SSE stream dies the
// moment `pm2 stop selva-compute` succeeds (selva-compute IS the SSE server),
// so the frontend loses visibility into everything that happens after — npm
// update output, pm2 start result, health-probe results, rollback decisions.
// The script keeps writing to this file regardless. Once the new selva-compute
// process is back up, the frontend polls GET on this same route to fetch the
// full log and reveal what happened during the blackout. One log per update —
// the wrapper truncates at start, so we never carry stale content forward.
const UPDATE_LOG_PATH = '/tmp/selva-update.log';

// Strip ANSI escape codes from terminal output
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}

function readRuntimeVersion(dir: string): string | undefined {
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'), 'utf8')
		);
		return typeof pkg.version === 'string' ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

// Quote a single argv element for safe embedding in a bash single-quoted
// string. Wraps in single quotes and escapes any embedded single quotes
// using the standard `'\''` trick. We pass user-controlled values (plan.cwd
// is from process.cwd(), npm package names are hardcoded) but defensive
// quoting is cheap.
function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Wrap the actual update commands in a tiny "launcher" that daemonizes them.
//
// THE PROBLEM this solves: `pm2 stop selva-compute` (which the runner has to
// call) uses tree-kill. It walks /proc parent-child relationships starting
// from selva-compute's PID and SIGKILLs every descendant. Node's
// `{ detached: true }` + `child.unref()` puts the spawned bash in a new
// session/process group, but does NOT change the parent-child relationship
// — so tree-kill still finds it and kills it. Result: bash dies mid-update,
// the app never gets restarted, site stays down until someone SSHes in.
//
// THE FIX: write the actual update commands to a tempfile and launch them
// via `setsid bash ... &`, then have the launcher exit. The runner's PPID
// becomes 1 (init) the moment the launcher exits, so it's no longer a
// descendant of selva-compute and tree-kill can't reach it.
//
// Output handling:
//   - The launcher's prelude lines are echoed via tee into UPDATE_LOG_PATH
//     AND through stdout (visible to SSE while the connection is still up).
//   - The runner appends its output directly to the same log file.
//   - The frontend tolerates the SSE blackout by polling the log file.
function buildLauncher(runnerScript: string, prelude: string[] = []): string {
	const echoes = prelude.map((line) => `echo ${shellQuote(line)}`).join('\n');
	// Note: runner script is embedded via a QUOTED heredoc so no variable
	// expansion happens — the runner text is written verbatim.
	return `
LOGFILE=${shellQuote(UPDATE_LOG_PATH)}
RUNNER=/tmp/selva-update-runner.sh
mkdir -p "$(dirname "$LOGFILE")"
: > "$LOGFILE"

cat > "$RUNNER" <<'__SELVA_RUNNER_EOF__'
${runnerScript}
__SELVA_RUNNER_EOF__
chmod +x "$RUNNER"

trap '' PIPE
exec > >(tee --output-error=warn-nopipe -a "$LOGFILE" 2>/dev/null) 2>&1
${echoes}

# Daemonize the runner so PM2's tree-kill of selva-compute can't reach it.
# setsid puts it in a new session; the trailing & + disown + launcher exit
# leaves the runner with PPID=1 once we're gone. stdin/stdout/stderr are
# fully detached from this process (and from selva-compute's pipes).
setsid bash "$RUNNER" </dev/null >>"$LOGFILE" 2>&1 &
RUNNER_PID=$!
disown
echo "[INFO] Update runner started (PID $RUNNER_PID, log: $LOGFILE)"

# Small pause so the runner has time to print its first line before SSE
# closes — otherwise the frontend's first poll might see no progress.
sleep 1
exit 0
`;
}

// Bash script the daemonized runner executes. Flow:
//
//   1. pre-flight    — query the registry; if we're already on latest, exit
//                      clean WITHOUT touching the running app. Saves a
//                      pointless downtime cycle.
//   2. pm2 sync      — `pm2 update` if the daemon and CLI versions drifted.
//   3. pm2 stop      — stop selva-compute before npm overwrites build/, so
//                      in-flight requests can't hit ERR_MODULE_NOT_FOUND
//                      from chunk-hash churn under their feet.
//   4. npm update    — refresh @selvajs/* (--prefer-online bypasses the
//                      packument cache, already baked into npmArgs).
//   5. pm2 start     — from ecosystem.config.cjs (not `pm2 start name`,
//                      which requires the process to already be in pm2's
//                      in-memory list — fragile after `pm2 update`).
//   6. health probe  — poll /api/health for up to 30s.
//   7. rollback      — on failure: npm install the prior version, restart.
//   8. EXIT trap     — last-resort: if anything above leaves the app
//                      offline (crash, kill, network blip), unconditionally
//                      try `pm2 start ecosystem.config.cjs` before exiting
//                      so the customer's site doesn't stay dark.
//
// Embedded into the launcher via a quoted heredoc, so this whole string is
// written verbatim — interpolated values must be shell-quoted at JS time.
function buildNpmRunnerScript(
	npmArgs: string[],
	versionBefore: string | undefined,
	ecosystemPath: string,
	tag: string
): string {
	const npmCommand = ['npm', ...npmArgs].map(shellQuote).join(' ');
	// Empty string when versionBefore is undefined — bash sees `BEFORE=""`
	// and skips the rollback path (you can't roll back to nothing).
	const before = shellQuote(versionBefore ?? '');
	const ecosystem = shellQuote(ecosystemPath);
	// The npm dist-tag the chosen channel resolves to (`latest` / `beta`). The
	// pre-flight and no-change warning query this tag, so they don't misfire on
	// a beta channel (where the channel's published version is a pre-release the
	// default `latest` query would never see) or on a revert (where the target
	// stable version is OLDER than the installed beta).
	const distTag = shellQuote(tag);

	return `#!/bin/bash
set -o pipefail
BEFORE=${before}
ECOSYSTEM=${ecosystem}
TAG=${distTag}

# Last-resort safety net. If the script exits with the app NOT online for
# any reason (crash, kill -9, network blip, npm hang past timeout), try to
# bring it back from ecosystem.config.cjs before we go. The whole point of
# this script is to update the app; leaving it down is the worst possible
# outcome.
on_exit() {
  STATUS=$(pm2 jlist 2>/dev/null | node -e "
    try {
      const list = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
      const app = list.find(p => p.name === 'selva-compute');
      process.stdout.write(app ? app.pm2_env.status : 'missing');
    } catch { process.stdout.write('error'); }
  " 2>/dev/null || echo "error")
  if [ "$STATUS" != "online" ]; then
    echo "[RECOVER] selva-compute is '$STATUS' — starting from ecosystem.config.cjs"
    pm2 start "$ECOSYSTEM" --update-env >/dev/null 2>&1 || \\
      echo "[RECOVER] pm2 start failed — manual intervention required: cd $(dirname "$ECOSYSTEM") && pm2 start ecosystem.config.cjs"
  fi
}
trap on_exit EXIT

# ---------------------------------------------------------------------------
# 1. Pre-flight: skip the whole cycle if there's nothing to install.
# ---------------------------------------------------------------------------
# Without this, clicking "Update" on an already-current instance triggered
# a full stop/install/start cycle and a downtime window for no reason. Now
# we just check the registry first.
echo "[STEP] Checking npm registry for the '$TAG' channel version"
LATEST=$(npm view "@selvajs/selva@$TAG" version --silent 2>/dev/null || echo "")
if [ -z "$LATEST" ]; then
  echo "[WARN] Could not query npm registry — proceeding with update attempt anyway"
elif [ -n "$BEFORE" ] && [ "$LATEST" = "$BEFORE" ]; then
  echo "[INFO] Already on the '$TAG' channel version ($BEFORE)"
  echo "[DONE] Nothing to do"
  exit 0
else
  # May be a forward update OR a revert (target older than installed) — either
  # way the installed version differs from what this channel publishes.
  echo "[INFO] Target ($TAG): $BEFORE → $LATEST"
fi

# ---------------------------------------------------------------------------
# 2. Resync PM2 daemon if its in-memory version drifted from the CLI on disk.
# ---------------------------------------------------------------------------
# After a global pm2 upgrade the daemon keeps running its original version
# while the CLI moves forward. Process commands then talk to a stale daemon
# and the symptom is "stop works, start never lands". \`pm2 update\` dumps
# processes, kills the daemon, respawns on the current CLI, restores the
# dump. Doing it before we touch anything keeps the rest of the script
# talking to a coherent daemon.
echo "[STEP] Checking PM2 daemon/CLI version sync"
if pm2 ping 2>&1 | grep -q "out-of-date" || pm2 list 2>&1 | grep -q "out-of-date"; then
  echo "[STEP] PM2 daemon is out-of-date — running 'pm2 update' to resync"
  if ! pm2 update; then
    echo "[FATAL] pm2 update failed — aborting before stopping the running app"
    exit 1
  fi
  echo "[INFO] PM2 daemon resynced"
fi

# ---------------------------------------------------------------------------
# 3. Stop selva-compute BEFORE npm rewrites build/.
# ---------------------------------------------------------------------------
# SvelteKit's node adapter lazy-imports chunks from build/server/chunks/ on
# every request. Letting npm rewrite build/ while the old process is still
# serving traffic = in-flight requests hit ERR_MODULE_NOT_FOUND for chunks
# whose hash just changed under their feet. Stopping first is a brief
# downtime window (~1-2s longer than restart-in-place) for a much smaller
# blast radius.
#
# This is also where the SSE connection to the frontend dies — selva-compute
# IS the SSE server. From here on, the user sees output via the log-file
# polling fallback in the admin UI, not over SSE.
echo "[STEP] Stopping selva-compute"
if ! pm2 stop selva-compute; then
  echo "[WARN] pm2 stop failed — selva-compute may not be running yet. Continuing."
fi

# ---------------------------------------------------------------------------
# 4. Run npm update.
# ---------------------------------------------------------------------------
echo "[STEP] Updating @selvajs/* packages"
if ! ${npmCommand}; then
  echo "[FATAL] npm update failed — EXIT trap will restart the previous build"
  exit 1
fi

AFTER=$(node -e "try{console.log(require('./node_modules/@selvajs/selva/package.json').version)}catch(e){}" 2>/dev/null)
echo "[INFO] New @selvajs/selva: \${AFTER:-unknown}"

if [ -n "$BEFORE" ] && [ "$BEFORE" = "$AFTER" ]; then
  echo "[WARN] No version change ($BEFORE). Your npm cache may be stale."
  echo "[WARN] Recover with:"
  echo "[WARN]   npm cache clean --force"
  echo "[WARN]   rm -rf node_modules package-lock.json"
  echo "[WARN]   npm install --prefer-online"
fi

# ---------------------------------------------------------------------------
# 5. Start selva-compute with the new build.
# ---------------------------------------------------------------------------
# Start from ecosystem.config.cjs, NOT \`pm2 start selva-compute\` — the
# latter requires selva-compute to already be in pm2's in-memory process
# list. After a \`pm2 update\` (step 2) that's not guaranteed.
echo "[STEP] Starting selva-compute with new build"
if ! pm2 start "$ECOSYSTEM" --update-env; then
  echo "[FATAL] pm2 start failed — investigate with \\\`pm2 logs selva-compute\\\`"
  exit 2
fi

# ---------------------------------------------------------------------------
# 6. Health probe the new process.
# ---------------------------------------------------------------------------
# Read PORT from .env the same way scripts/update.sh does, so non-default
# ports are respected.
PORT=$(grep "^PORT=" .env 2>/dev/null \\
  | head -1 \\
  | cut -d'=' -f2 \\
  | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^["'"'"']//' -e 's/["'"'"']$//' -e 's/[[:space:]]*#.*//')
PORT=\${PORT:-3000}

echo "[STEP] Health-probing the new process on port $PORT"
HEALTHY=0
for i in $(seq 1 15); do
  sleep 2
  CODE=$(curl -sS -o /tmp/selva-health.$$ -w "%{http_code}" --max-time 5 "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
  if [ "$CODE" = "200" ]; then
    HEALTHY=1
    echo "[INFO] Health probe passed after \${i} attempt(s)"
    rm -f /tmp/selva-health.$$
    break
  fi
  echo "[INFO] Probe attempt $i/15: HTTP $CODE — retrying"
done

if [ "$HEALTHY" = "1" ]; then
  echo "[DONE] Update complete"
  exit 0
fi

# ---------------------------------------------------------------------------
# 7. Rollback path.
# ---------------------------------------------------------------------------
echo "[FATAL] New process failed health check after 30s"
if [ -f /tmp/selva-health.$$ ]; then
  echo "[FATAL] Last response body:"
  cat /tmp/selva-health.$$
  rm -f /tmp/selva-health.$$
fi

if [ -z "$BEFORE" ]; then
  echo "[FATAL] No prior version recorded — cannot roll back automatically."
  echo "[FATAL] EXIT trap will attempt to restart the current build anyway."
  exit 3
fi

echo "[STEP] Rolling back @selvajs/selva to $BEFORE"
pm2 stop selva-compute >/dev/null 2>&1 || true
if ! npm install --save "@selvajs/selva@$BEFORE"; then
  echo "[FATAL] Rollback npm install failed — EXIT trap will retry restart."
  exit 4
fi

pm2 start "$ECOSYSTEM" --update-env || true
sleep 3
ROLLBACK_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$PORT/api/health" 2>/dev/null || echo "000")
if [ "$ROLLBACK_CODE" = "200" ]; then
  echo "[DONE] Rolled back to $BEFORE — previous version is online"
  exit 5
fi

echo "[FATAL] Rollback restart also failed health check (HTTP $ROLLBACK_CODE)"
echo "[FATAL] Manual recovery required. Check: pm2 logs selva-compute"
exit 6
`;
}

// Selva self-updates as a CLI-scaffolded npm deployment: the deployment dir
// holds a package.json that depends on @selvajs/selva, and update means
// `npm update @selvajs/*` + pm2 restart. We probe the cwd upward for the
// installed package as proof we're in such a deployment.
//
// `INSTALL_DIR` lets an operator pin the deployment root explicitly (useful
// when the SvelteKit process cwd isn't the install dir).
type UpdatePlan = { cwd: string; args: string[] };

function isDeploymentDir(dir: string): boolean {
	return existsSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'));
}

// All @selvajs/* packages move together — fixing a provider-only bug without
// bumping the runtime is a supported flow.
//
// We `npm install` the packages pinned to the channel's dist-tag rather than
// `npm update`, because `update` only ever moves FORWARD within the installed
// semver range — it can't switch dist-tags or DOWNGRADE. Pinning to @latest /
// @beta makes one command serve every transition: forward stable bumps,
// beta→newer-beta, and the revert case (beta→stable lands on an older version).
//
// --save persists the resolved version into package.json so the next plain
// install is reproducible; --prefer-online forces npm to revalidate cached
// packuments against the registry. Without it, npm's packument cache (5+ min
// TTL) can silently no-op right after publish. See docs/Hotfix-CLI-Runtime.md
// "stale-packument-cache trap".
function npmInstallArgs(channel: ReleaseChannel): string[] {
	const tag = channelTag(channel);
	return ['install', '--save', '--prefer-online', `@selvajs/cli@${tag}`, `@selvajs/selva@${tag}`];
}

function detectUpdatePlan(channel: ReleaseChannel): UpdatePlan | null {
	const args = npmInstallArgs(channel);
	if (env.INSTALL_DIR && isDeploymentDir(env.INSTALL_DIR)) {
		return { cwd: env.INSTALL_DIR, args };
	}

	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		if (isDeploymentDir(dir)) {
			return { cwd: dir, args };
		}
		const parent = join(dir, '..');
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

// POST - Run update and stream output via Server-Sent Events.
//
// Runs `npm update @selvajs/*` then restarts via ecosystem.config.cjs. The
// runner script handles stop / update / start / health-probe / rollback with
// an EXIT trap that keeps the app online no matter how it exits.
export const POST: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');

	const channel = readChannel();
	const plan = detectUpdatePlan(channel);
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

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function sendEvent(type: string, data: Record<string, unknown>) {
				const message = `data: ${JSON.stringify({ type, ...data })}\n\n`;
				controller.enqueue(encoder.encode(message));
			}

			try {
				// Capture the runtime version BEFORE we touch anything, so we
				// can: (a) detect a no-op update and warn, (b) roll back to the
				// prior version if the new process fails to come up healthy.
				const versionBefore = readRuntimeVersion(plan.cwd);

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
				const args = ['-c', buildLauncher(runnerScript, prelude)];

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
						// eslint-disable-next-line no-restricted-properties -- OS env for the spawned child, not .env config
						PATH: `${localBin}:${process.env.PATH ?? ''}`,
						// eslint-disable-next-line no-restricted-properties -- OS env for the spawned child, not .env config
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
		body = readFileSync(UPDATE_LOG_PATH, 'utf8');
	} catch {
		// Log doesn't exist (no update has run, or /tmp was wiped). Empty body
		// is correct — the frontend treats no content as "nothing to show yet".
	}
	return new Response(body, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': 'no-store'
		}
	});
};
