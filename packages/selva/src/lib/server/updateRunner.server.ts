/**
 * Generates the bash the self-update POST route spawns: a tiny daemonizing
 * launcher plus the runner script that actually stops/updates/starts/health-
 * checks the deployment. Split out of the route file because SvelteKit's
 * route-file validator only allows HTTP-verb exports (and `_`-prefixed ones) —
 * these are plain functions the runner-script contract tests import directly.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findDeploymentDir } from './selfUpdate.server.js';
import { channelTag, type ReleaseChannel } from './releaseChannel.server.js';

export function readRuntimeVersion(dir: string): string | undefined {
	try {
		const pkg = JSON.parse(
			readFileSync(join(dir, 'node_modules', '@selvajs', 'selva', 'package.json'), 'utf8')
		);
		return typeof pkg.version === 'string' ? pkg.version : undefined;
	} catch {
		return undefined;
	}
}

// Wraps in single quotes and escapes embedded single quotes with the
// standard `'\''` trick. No caller currently passes untrusted input
// (plan.cwd is from process.cwd(), npm package names are hardcoded), but
// defensive quoting is cheap.
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Wraps the actual update commands in a tiny "launcher" that daemonizes them.
//
// THE PROBLEM: `pm2 stop selva-compute` (which the runner has to call) uses
// tree-kill, which walks /proc parent-child relationships from
// selva-compute's PID and SIGKILLs every descendant. Node's
// `{ detached: true }` + `child.unref()` puts the spawned bash in a new
// session/process group but does NOT change the parent-child relationship —
// so tree-kill still finds and kills it, and the app never restarts.
//
// THE FIX: write the update commands to a tempfile and launch them via
// `setsid bash ... &`, then have the launcher exit. The runner's PPID becomes
// 1 (init) the moment the launcher exits, so it's no longer a descendant of
// selva-compute and tree-kill can't reach it.
//
// Output: the launcher's prelude lines are echoed via tee into
// UPDATE_LOG_PATH and through stdout (visible to SSE while the connection is
// still up); the runner appends its output to the same log file; the
// frontend tolerates the SSE blackout by polling the log file.
export function buildLauncher(
	runnerScript: string,
	logPath: string,
	prelude: string[] = []
): string {
	const echoes = prelude.map((line) => `echo ${shellQuote(line)}`).join('\n');
	// Note: runner script is embedded via a QUOTED heredoc so no variable
	// expansion happens — the runner text is written verbatim.
	return `
LOGFILE=${shellQuote(logPath)}
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
//   1. pre-flight    — query the registry; if already on latest, exit clean
//                      WITHOUT touching the running app.
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
export function buildNpmRunnerScript(
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

# Resolve the deployment-local pm2 explicitly instead of trusting PATH.
# The runner is re-launched via \`setsid bash\` from a tempfile, so it inherits
# whatever environment the spawning process had. When the update is triggered
# from the admin UI that happens to include node_modules/.bin; from cron or a
# bare shell it does not, and every pm2 call below — including the EXIT trap's
# last-resort restart — fails with "command not found" and the app stays dark.
PM2="$(dirname "$ECOSYSTEM")/node_modules/.bin/pm2"
[ -x "$PM2" ] || PM2=pm2

# Waits for selva-compute to leave the transitional 'stopping' state.
#
# \`pm2 stop\` sends SIGINT and returns without waiting for the process to die.
# The SvelteKit node adapter then drains in-flight requests before exiting, and
# PM2 only escalates to SIGKILL after kill_timeout (10s in the scaffolded
# ecosystem). For that whole window the process table entry has a name and an
# id but no live pid — \`pm2 start\` resolves the name, converts to a restart,
# finds nothing to restart, and pm2's own table printer crashes on
# \`undefined.pm2_env\`. Polling here keeps the rest of the script out of that
# window entirely.
#
# The drain reliably takes the full timeout when the update was triggered from
# the admin UI: that page is fed by an SSE stream this very process serves, and
# an open SSE stream never completes on its own.
# Prints exactly one word. Callers compare it against 'online' / 'stopping', so
# a probe that emits two tokens on failure (the inline catch AND a shell
# fallback both firing) would silently never match either. Node's catch is the
# single failure path; fd 0 rather than /dev/stdin because the latter isn't a
# readable pipe everywhere.
app_status() {
  "$PM2" jlist 2>/dev/null | node -e "
    try {
      const list = JSON.parse(require('fs').readFileSync(0,'utf8'));
      const app = list.find(p => p.name === 'selva-compute');
      process.stdout.write(app ? app.pm2_env.status : 'missing');
    } catch { process.stdout.write('error'); }
  " 2>/dev/null
}

wait_until_stopped() {
  for i in $(seq 1 20); do
    STATUS=$(app_status)
    if [ "$STATUS" != "stopping" ]; then
      return 0
    fi
    echo "[INFO] selva-compute still draining (attempt $i/20) — waiting for SIGKILL escalation"
    sleep 1
  done
  echo "[WARN] selva-compute stuck in 'stopping' after 20s — continuing anyway"
  return 1
}

# \`pm2 start <ecosystem>\` converts to a restart-by-id when an entry of the same
# name is already in the table. If that entry is stale the restart fails and no
# amount of retrying the same command helps — the name has to be dropped first
# so the start registers a fresh process. Deleting a stopped entry is safe: the
# ecosystem file is the source of truth for how to bring it back.
start_app() {
  if "$PM2" start "$ECOSYSTEM" --update-env; then
    return 0
  fi
  echo "[WARN] pm2 start failed — dropping the stale process entry and retrying"
  "$PM2" delete selva-compute >/dev/null 2>&1 || true
  "$PM2" start "$ECOSYSTEM" --update-env
}

# Last-resort safety net. If the script exits with the app NOT online for
# any reason (crash, kill -9, network blip, npm hang past timeout), try to
# bring it back from ecosystem.config.cjs before exiting. Leaving the app
# down is the worst possible outcome of an update.
on_exit() {
  CODE=$?
  STATUS=$(app_status)
  # A 'stopping' entry is mid-drain, not down. Restarting it now hits the same
  # dead-id window that brought us here; wait for the entry to settle first.
  if [ "$STATUS" = "stopping" ]; then
    wait_until_stopped
    STATUS=$(app_status)
  fi
  if [ "$STATUS" != "online" ]; then
    echo "[RECOVER] selva-compute is '$STATUS' — starting from ecosystem.config.cjs"
    start_app >/dev/null 2>&1 || \\
      echo "[RECOVER] pm2 start failed — manual intervention required: cd $(dirname "$ECOSYSTEM") && ./node_modules/.bin/pm2 delete selva-compute; ./node_modules/.bin/pm2 start ecosystem.config.cjs"
  fi
  # Terminal marker: the restarted app's outcome reconciler greps this to turn
  # the run into an audit event (selfUpdate.server.ts). Keep the format stable.
  echo "[EXIT] code=$CODE"
}
trap on_exit EXIT

# A killed runner must not look like a finished one.
#
# \`$?\` inside an EXIT trap reports the last completed command, NOT the signal.
# When systemd SIGTERMs the whole cgroup, the EXIT trap still runs and records
# \`code=0\` — so deriveOutcome takes the exit-0 success branch and tells the
# operator "Updated X → Y. The app is back online." while npm never ran and
# the deployment is unchanged. Catching the signal makes the recorded code
# truthful; 143/130 are the conventional 128+signal values.
on_signal() {
  SIG=$1
  echo "[FATAL] KILLED: runner received SIG$SIG before finishing."
  echo "[FATAL] Nothing was installed by this run. If the app is down, recover with:"
  echo "[FATAL]   cd $(dirname "$ECOSYSTEM") && pm2 start ecosystem.config.cjs --update-env"
  echo "[FATAL] A systemd-supervised pm2 can do this when 'pm2 update' recycles the daemon."
  exit $2
}
trap 'on_signal TERM 143' TERM
trap 'on_signal INT 130' INT
trap 'on_signal HUP 129' HUP

# ---------------------------------------------------------------------------
# 1. Pre-flight: skip the whole cycle if there's nothing to install.
# ---------------------------------------------------------------------------
# Without this, clicking "Update" on an already-current instance triggers a
# full stop/install/start cycle and a downtime window for no reason.
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
# 1b. Node engine pre-flight — BEFORE any downtime.
# ---------------------------------------------------------------------------
# npm only treats an engine mismatch as fatal under engine-strict=true, which
# no deployment sets. So a release requiring a newer Node installs
# "successfully", pm2 starts, and /api/health returns 200 (it touches nothing
# Node-version specific) — a false green that skips rollback entirely. Warn
# here so a CLI-driven run sees it too; the admin UI blocks earlier.
REQUIRED_NODE=$(npm view "@selvajs/selva@$TAG" engines.node --silent 2>/dev/null | tr -d '"' | tr -d "'")
RUNNING_NODE=$(node -p 'process.versions.node' 2>/dev/null)
if [ -n "$REQUIRED_NODE" ] && [ -n "$RUNNING_NODE" ]; then
  # Compare majors only — the ranges we publish are all \`>=X\` forms.
  REQ_MAJOR=$(echo "$REQUIRED_NODE" | grep -o '[0-9]\\+' | head -1)
  RUN_MAJOR=$(echo "$RUNNING_NODE" | cut -d. -f1)
  if [ -n "$REQ_MAJOR" ] && [ "$RUN_MAJOR" -lt "$REQ_MAJOR" ] 2>/dev/null; then
    echo "[WARN] ENGINE_MISMATCH: @selvajs/selva@$LATEST requires Node $REQUIRED_NODE but this host runs v$RUNNING_NODE"
    echo "[WARN] npm will install it anyway (engine-strict is off) and the health probe will pass,"
    echo "[WARN] but routes using newer Node APIs will fail at request time. Upgrade Node on this host."
  fi
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
PING_OUT=$("$PM2" ping 2>&1)
if echo "$PING_OUT" | grep -q "out-of-date"; then
  # pm2 prints both versions alongside the warning. Which is newer decides
  # whether \`pm2 update\` can help — see the direction check below.
  DAEMON_V=$(echo "$PING_OUT" | sed -e 's/\\x1b\\[[0-9;]*m//g' \\
    | grep -i "In memory PM2 version" | grep -o '[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+' | head -1)
  LOCAL_V=$(echo "$PING_OUT" | sed -e 's/\\x1b\\[[0-9;]*m//g' \\
    | grep -i "Local PM2 version" | grep -o '[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+' | head -1)
  DAEMON_MAJOR=\${DAEMON_V%%.*}
  LOCAL_MAJOR=\${LOCAL_V%%.*}

  # A daemon NEWER than the deployment-local CLI means a foreign global pm2 owns
  # it. \`pm2 update\` would DOWNGRADE the daemon and feed it a dump it can't read,
  # losing the process table — selva-compute never gets re-registered. That is an
  # operator problem, not something this script can repair, so stop before we
  # take the app down.
  if [ -n "$DAEMON_MAJOR" ] && [ -n "$LOCAL_MAJOR" ] && [ "$DAEMON_MAJOR" -gt "$LOCAL_MAJOR" ] 2>/dev/null; then
    echo "[FATAL] PM2_SKEW: the running daemon (v$DAEMON_V) is NEWER than this deployment's pm2 (v$LOCAL_V)."
    echo "[FATAL] A global pm2 owns the daemon. Running 'pm2 update' would downgrade it and drop"
    echo "[FATAL] the process table. Resolve manually before updating:"
    echo "[FATAL]   which -a pm2 && pm2 -v && pm2 ping"
    echo "[FATAL] Aborting WITHOUT stopping the app — it is still running."
    exit 8
  fi

  # Under systemd, \`pm2 update\` kills and respawns the daemon. systemd sees its
  # unit's main process die and, with the default KillMode=control-group,
  # SIGTERMs everything in the cgroup — including this runner. setsid escapes
  # PM2's tree-kill but NOT the cgroup, so there is no way to survive it from
  # here; refuse the resync instead of being killed by it.
  if grep -qs 'pm2.*\\.service' /proc/self/cgroup 2>/dev/null; then
    echo "[FATAL] SYSTEMD_PM2: this deployment's PM2 is supervised by systemd, and the daemon"
    echo "[FATAL] needs a resync. Running 'pm2 update' here would restart the systemd unit and"
    echo "[FATAL] kill this runner mid-update. Resync manually from a shell, then retry:"
    echo "[FATAL]   cd $(dirname "$ECOSYSTEM") && ./node_modules/.bin/pm2 update"
    echo "[FATAL] Aborting WITHOUT stopping the app — it is still running."
    exit 9
  fi

  echo "[STEP] PM2 daemon is out-of-date — running 'pm2 update' to resync"
  if ! "$PM2" update; then
    echo "[FATAL] pm2 update failed — aborting before stopping the running app"
    exit 1
  fi
  echo "[INFO] PM2 daemon resynced"
fi

# ---------------------------------------------------------------------------
# 3. Stop selva-compute BEFORE npm rewrites build/.
# ---------------------------------------------------------------------------
# SvelteKit's node adapter lazy-imports chunks from build/server/chunks/ on
# every request. Letting npm rewrite build/ while the old process still
# serves traffic means in-flight requests hit ERR_MODULE_NOT_FOUND for chunks
# whose hash just changed under their feet. Stopping first is a brief
# downtime window (~1-2s longer than restart-in-place) for a much smaller
# blast radius.
#
# This is also where the SSE connection to the frontend dies — selva-compute
# IS the SSE server. From here on, the user sees output via the log-file
# polling fallback in the admin UI, not over SSE.
echo "[STEP] Stopping selva-compute"
if ! "$PM2" stop selva-compute; then
  echo "[WARN] pm2 stop failed — selva-compute may not be running yet. Continuing."
fi

# pm2 stop returns before the process is actually gone. Everything below —
# npm rewriting build/, then the restart — must happen outside the drain window.
wait_until_stopped

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
# Start from ecosystem.config.cjs, NOT \`pm2 start selva-compute\` — the latter
# requires selva-compute to already be in pm2's in-memory process list, which
# a \`pm2 update\` (step 2) isn't guaranteed to preserve.
echo "[STEP] Starting selva-compute with new build"
if ! start_app; then
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
"$PM2" stop selva-compute >/dev/null 2>&1 || true
wait_until_stopped >/dev/null 2>&1
# Restore @selvajs/cli alongside the runtime: the forward step installs both at
# the channel tag, so reverting only the runtime leaves a version pair that was
# never released together.
if ! npm install --save "@selvajs/cli@$BEFORE" "@selvajs/selva@$BEFORE"; then
  echo "[FATAL] Rollback npm install failed — EXIT trap will retry restart."
  exit 4
fi

start_app || true
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
// `npm install @selvajs/*@<tag>` + pm2 restart. Deployment-dir detection
// (cwd-upward probe, `INSTALL_DIR` override) lives in `selfUpdate.server.ts`,
// shared with the outcome reconciler and the log path.
export type UpdatePlan = { cwd: string; args: string[] };

// All @selvajs/* packages move together — fixing a provider-only bug without
// bumping the runtime is a supported flow.
//
// `npm install` pins to the channel's dist-tag rather than using `npm
// update`, because `update` only ever moves FORWARD within the installed
// semver range — it can't switch dist-tags or DOWNGRADE. Pinning to @latest /
// @beta makes one command serve every transition: forward stable bumps,
// beta→newer-beta, and the revert case (beta→stable lands on an older version).
//
// --save persists the resolved version into package.json so the next plain
// install is reproducible; --prefer-online forces npm to revalidate cached
// packuments against the registry — without it, npm's packument cache (5+
// min TTL) can silently no-op right after publish.
export function npmInstallArgs(channel: ReleaseChannel): string[] {
	const tag = channelTag(channel);
	return ['install', '--save', '--prefer-online', `@selvajs/cli@${tag}`, `@selvajs/selva@${tag}`];
}

export function detectUpdatePlan(
	env: Record<string, string | undefined>,
	channel: ReleaseChannel
): UpdatePlan | null {
	const dir = findDeploymentDir(env);
	return dir ? { cwd: dir, args: npmInstallArgs(channel) } : null;
}
