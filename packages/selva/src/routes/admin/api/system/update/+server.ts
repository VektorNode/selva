import { spawn } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';
import { requirePermission } from '$lib/server/access.server';

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

// Wrap an inner bash command with a tee redirect so all stdout+stderr is
// mirrored to UPDATE_LOG_PATH. We rebind file descriptors via `exec >
// >(tee -a ...) 2>&1` so every subsequent command in the same shell — and
// every subprocess that inherits these fds — writes to both the original
// pipe (for SSE while it's alive) and the file (for catch-up after the
// blackout). The file is truncated at the top so each update starts clean.
//
// `prelude` lines are echoed AFTER the tee redirect is in place, so they
// land in both the SSE stream (via the bash stdout pipe) and the file. This
// is how we get parity between what the frontend sees over SSE and what it
// reads back from the file when SSE dies — without it, anything we
// sendEvent'd from JS before spawning bash would silently disappear when
// the frontend replaces its log buffer with the file content.
//
// SIGPIPE survival is the whole point of this wrapper. The SSE consumer is
// served by selva-compute, so the moment the script runs `pm2 stop selva-
// compute` the pipe between tee and the parent breaks. Without protection
// the cascade is: tee gets SIGPIPE on its stdout → tee dies → bash's next
// write hits a dead tee → bash gets SIGPIPE → entire script aborts mid-
// flight (right after pm2 stop, before npm update or pm2 start). Two
// guards prevent that:
//   1. `tee --output-error=warn-nopipe` keeps tee alive when its stdout
//      pipe breaks (file writes still succeed). GNU coreutils 8.25+.
//   2. `trap '' PIPE` makes bash itself ignore SIGPIPE so a stray write
//      to the original stdout (anything that bypasses tee) returns EPIPE
//      instead of killing the shell.
//   3. `2>/dev/null` on tee silences its EPIPE warning, which would
//      otherwise be a write to the equally-broken stderr pipe.
function wrapWithTee(innerCommand: string, prelude: string[] = []): string {
	const echoes = prelude.map((line) => `echo ${shellQuote(line)}`).join('\n');
	return `
LOGFILE=${shellQuote(UPDATE_LOG_PATH)}
mkdir -p "$(dirname "$LOGFILE")"
: > "$LOGFILE"
trap '' PIPE
exec > >(tee --output-error=warn-nopipe -a "$LOGFILE" 2>/dev/null) 2>&1
${echoes}
${innerCommand}
`;
}

// Generate the bash pipeline that runs in npm-mode updates. Four phases:
//
//   1. npm update         — refresh @selvajs/* packages, --prefer-online to
//                           bypass packument cache (already in npmArgs).
//   2. pm2 restart        — --update-env so .env changes apply.
//   3. health probe       — poll /api/health for up to 30s. The new process
//                           must reach 200 with the running version no
//                           longer matching versionBefore (so we know we're
//                           talking to the new process, not the old one
//                           PM2 hasn't killed yet).
//   4. rollback (if fail) — npm install the prior version, pm2 restart again.
//
// We emit one bash script (not a Node pipeline) so it survives the SSE
// stream closing — `child.unref()` keeps it alive across browser tab close.
// All output is line-buffered to stderr/stdout so the SSE consumer can
// stream it without seeing it batched at the end.
function buildNpmUpdateScript(npmArgs: string[], versionBefore: string | undefined): string {
	const npmCommand = ['npm', ...npmArgs].map(shellQuote).join(' ');
	// Empty string when versionBefore is undefined — bash sees `BEFORE=""`
	// and skips the rollback path (you can't roll back to nothing).
	const before = shellQuote(versionBefore ?? '');

	return `
set -o pipefail
BEFORE=${before}

# PM2's in-memory daemon and the installed CLI can drift apart after a
# global pm2 upgrade — the daemon keeps running whatever version started it,
# while the CLI on disk moves forward. When they diverge, PM2 prints
# "In-memory PM2 is out-of-date" and process commands talk to a stale
# daemon, manifesting as restarts that stop the old process but never bring
# the new one online. \`pm2 update\` dumps processes, kills the daemon,
# respawns it on the current CLI version, and restores the processes.
# Resync proactively so the stop/start below talks to a coherent daemon.
echo "[STEP] Checking PM2 daemon/CLI version sync"
if pm2 ping 2>&1 | grep -q "out-of-date" || pm2 list 2>&1 | grep -q "out-of-date"; then
  echo "[STEP] PM2 daemon is out-of-date — running 'pm2 update' to resync before touching the app"
  if ! pm2 update; then
    echo "[FATAL] pm2 update failed — aborting before stopping the running app"
    exit 1
  fi
  echo "[INFO] PM2 daemon resynced"
fi

# IMPORTANT: stop the running process BEFORE npm update overwrites build/.
# SvelteKit's node adapter lazy-imports chunks from build/server/chunks/ on
# every request. If we let npm rewrite build/ while the old process is still
# serving traffic, in-flight requests hit ERR_MODULE_NOT_FOUND for chunks
# whose hash just changed under their feet. Stopping first is a brief
# downtime window (~1-2s longer than restart-in-place) for a much smaller
# blast radius.
echo "[STEP] Stopping selva-compute (graceful drain via kill_timeout in ecosystem.config.cjs)"
if ! pm2 stop selva-compute; then
  echo "[WARN] pm2 stop failed — selva-compute may not be running yet. Continuing."
fi

echo "[STEP] Updating @selvajs/* packages"
if ! ${npmCommand}; then
  echo "[FATAL] npm update failed — restarting old build to recover"
  pm2 start selva-compute --update-env >/dev/null 2>&1 || true
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

echo "[STEP] Starting selva-compute with new build"
if ! pm2 start selva-compute --update-env; then
  echo "[FATAL] pm2 start failed — investigate with \\\`pm2 logs selva-compute\\\`"
  exit 2
fi

echo "[STEP] Health-probing the new process"
HEALTHY=0
for i in $(seq 1 15); do
  sleep 2
  CODE=$(curl -sS -o /tmp/selva-health.$$ -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null || echo "000")
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

echo "[FATAL] New process failed health check after 30s"
if [ -f /tmp/selva-health.$$ ]; then
  echo "[FATAL] Last response body:"
  cat /tmp/selva-health.$$
  rm -f /tmp/selva-health.$$
fi

if [ -z "$BEFORE" ]; then
  echo "[FATAL] No prior version recorded — cannot roll back automatically."
  echo "[FATAL] Manually install the version you want: npm install @selvajs/selva@<version>"
  exit 3
fi

echo "[STEP] Rolling back @selvajs/selva to $BEFORE"
pm2 stop selva-compute >/dev/null 2>&1 || true
if ! npm install --save "@selvajs/selva@$BEFORE"; then
  echo "[FATAL] Rollback npm install failed — manual intervention required."
  pm2 start selva-compute --update-env >/dev/null 2>&1 || true
  exit 4
fi

pm2 start selva-compute --update-env || true
sleep 3
ROLLBACK_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3000/api/health 2>/dev/null || echo "000")
if [ "$ROLLBACK_CODE" = "200" ]; then
  echo "[DONE] Rolled back to $BEFORE — previous version is online"
  exit 5
fi

echo "[FATAL] Rollback restart also failed health check (HTTP $ROLLBACK_CODE)"
echo "[FATAL] Manual recovery required. Check: pm2 logs selva-compute"
exit 6
`;
}

// Selva runs in two valid shapes:
//
//   git  — a checkout of the monorepo (dev boxes, anyone running from source).
//          Update means: git pull + pnpm install + pnpm build + pm2 restart.
//          Implemented by scripts/update.sh, which only exists in the repo.
//
//   npm  — a CLI-scaffolded deployment (operators, customers). The deployment
//          dir holds a package.json that depends on @selvajs/selva. Update
//          means: npm update @selvajs/* + pm2 restart. There is no repo.
//
// We probe the cwd upward and pick the first shape we can prove. `scripts/
// update.sh` is the more specific marker (only the monorepo carries it), so
// it wins over `node_modules/@selvajs/selva` when both somehow coexist.
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
		if (existsSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'))) {
			// All @selvajs/* packages move together — fixing a provider-only bug
			// without bumping the runtime is a supported flow.
			//
			// --prefer-online forces npm to revalidate cached packuments against
			// the registry. Without it, npm's packument cache (5+ min TTL) can
			// silently no-op an update right after publish. See
			// docs/Hotfix-CLI-Runtime.md "stale-packument-cache trap".
			return {
				mode: 'npm',
				cwd: dir,
				cmd: 'npm',
				args: ['update', '--save', '--prefer-online', '@selvajs/cli', '@selvajs/selva']
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
					'node_modules/@selvajs/selva (CLI scaffold) in the cwd or a parent.'
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
				// In npm mode we capture the runtime version BEFORE we touch
				// anything, so we can: (a) detect a no-op update and warn,
				// (b) roll back to the prior version if the new process fails
				// to come up healthy. Git mode handles its own rollback inside
				// update.sh.
				const versionBefore = plan.mode === 'npm' ? readRuntimeVersion(plan.cwd) : undefined;

				// Prelude lines are passed to the bash wrapper rather than
				// sendEvent'd directly so they end up in both the SSE stream
				// (via bash stdout) AND the log file (via tee). Without this,
				// the frontend's blackout-recovery file fetch would clobber
				// these lines when it replaces its buffer with the file content.
				const prelude = [
					`[INFO] Update mode: ${plan.mode} (cwd: ${plan.cwd})`,
					...(versionBefore ? [`[INFO] Current @selvajs/selva: ${versionBefore}`] : [])
				];

				// Spawn the update command detached so it survives if PM2 kills
				// this Node process mid-restart, or if the SSE client disconnects.
				// detached:true puts the child in its own process group; unref()
				// stops it from blocking the event loop. stdio is piped so we can
				// stream output while the parent is still alive.
				//
				// Git mode: hand off to scripts/update.sh (has its own restart +
				// health-check + rollback baked in).
				//
				// Npm mode: emit a small bash pipeline that does
				//   1. npm update (already cache-busted via --prefer-online in plan.args)
				//   2. pm2 restart with --update-env
				//   3. health-probe loop against /api/health
				//   4. rollback if the probe never passes
				//
				// Both modes are wrapped by wrapWithTee so the script's full output
				// also lands in UPDATE_LOG_PATH. The SSE stream dies the instant pm2
				// stops selva-compute (the SvelteKit endpoint serving this stream
				// runs INSIDE selva-compute), but the detached bash process keeps
				// writing to the file until completion. The frontend recovers the
				// blackout content by GETing this same route once health returns.
				const innerCommand =
					plan.mode === 'git'
						? `exec ${shellQuote(plan.cmd)} ${plan.args.map(shellQuote).join(' ')}`
						: buildNpmUpdateScript(plan.args, versionBefore);
				const cmd = 'bash';
				const args = ['-c', wrapWithTee(innerCommand, prelude)];

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

// GET — read the tee'd update log so the frontend can recover the chunk of
// output that happened during the SSE blackout (between `pm2 stop` killing
// this process and the new selva-compute coming back online). Returns an
// empty body if no update has run yet on this host. Polled by the admin UI
// during the post-restart wait; not intended for general consumption.
export const GET: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');
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
