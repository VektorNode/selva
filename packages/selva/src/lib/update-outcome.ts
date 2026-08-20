// ============================================================================
// Update-outcome derivation
// ============================================================================
//
// The update runner (admin/api/system/update/+server.ts) emits structured log
// lines and a small set of meaningful exit codes. The UI must not collapse
// those into a vague "succeeded / failed" — an operator has to be able to
// tell, at a glance:
//
//   • whether anything actually changed (and from which version to which),
//   • whether the app is UP or DOWN right now,
//   • whether a failed update was safely rolled back (app fine) vs left the
//     app offline (urgent), and
//   • the exact next action when something is wrong.
//
// `deriveOutcome` is a pure function of (exitCode, logs) so it's testable in
// isolation. Severity ranking: anything that leaves the app DOWN is
// `critical`; a safe rollback is `warning`, not an error, because the site is
// still serving.

export type OutcomeSeverity = 'success' | 'info' | 'warning' | 'critical' | 'pending';

/**
 * Synthetic exit code for a run that never reported one — the SSE handler's
 * 15-minute group-kill, or the reconciler giving up on a missing [EXIT] marker.
 * Outside the 0-255 range a real process can produce, so it can't collide.
 */
export const TIMED_OUT = -2;

export interface UpdateOutcome {
	severity: OutcomeSeverity;
	/** One-line headline. Must be unambiguous about app up/down state. */
	title: string;
	/** Optional second line — what to do next when something is off. */
	detail?: string;
	/** Parsed "X → Y" version transition, when the log reported one. */
	from?: string;
	to?: string;
}

function firstMatch(logs: string, re: RegExp): string | undefined {
	const m = re.exec(logs);
	return m ? m[1] : undefined;
}

function parseVersions(logs: string): { from?: string; to?: string } {
	// The pre-flight transition line, printed BEFORE npm runs — the only source
	// of a target version when the update fails early or is a no-op:
	//   "[INFO] Target (beta): 4.2.0 → 4.2.1-beta.1"
	// `Available:` is the pre-channel spelling, still matched so a log captured
	// by an older runner keeps parsing. The arrow may be → or ->.
	const version = String.raw`\d+\.\d+\.\d+[^\s]*`;
	const transition = new RegExp(
		String.raw`(?:Target \([^)]*\)|Available):\s*(${version})\s*(?:→|->)\s*(${version})`
	);
	const arrow = transition.exec(logs);

	// The post-install lines are authoritative for what actually landed — prefer
	// them over the pre-flight target, which is only ever an intent.
	const from = firstMatch(logs, /Current @selvajs\/selva:\s*v?(\d+\.\d+\.\d+[^\s]*)/) ?? arrow?.[1];
	const to = firstMatch(logs, /New @selvajs\/selva:\s*v?(\d+\.\d+\.\d+[^\s]*)/) ?? arrow?.[2];
	return { from, to };
}

function has(logs: string, needle: string): boolean {
	return logs.includes(needle);
}

export function deriveOutcome(exitCode: number | null, logs: string): UpdateOutcome {
	const { from, to } = parseVersions(logs);

	if (exitCode === null) {
		return { severity: 'pending', title: 'Update in progress…' };
	}

	// --- Critical: app is or may be DOWN. Rank these first. -------------------
	if (
		exitCode === 6 ||
		has(logs, 'Manual recovery required') ||
		has(logs, 'manual intervention required')
	) {
		return {
			severity: 'critical',
			title: 'Update failed AND rollback failed — the app may be OFFLINE',
			detail:
				'Both the new version and the rollback failed their health check. ' +
				'SSH into the server and run: `pm2 logs selva-compute`, then ' +
				'`pm2 start ecosystem.config.cjs` from the deployment directory.',
			from,
			to
		};
	}
	// The SSE handler's 15-minute group-kill, and the reconciler's own poll cap.
	// Neither is an exit code the runner chose, so they carry no [EXIT] marker.
	if (exitCode === TIMED_OUT) {
		return {
			severity: 'critical',
			title: 'App did not come back online within 15 minutes',
			detail:
				'The update may still be finishing in the background, or the new ' +
				'process is crash-looping. Check `pm2 logs selva-compute`. Do not ' +
				're-run the update until you have confirmed the current state.',
			from,
			to
		};
	}
	// Exit 4: the rollback's own npm install failed, so node_modules is
	// half-written and the EXIT trap's restart is the only thing that may have
	// brought the app back. Same urgency as a failed rollback restart.
	if (exitCode === 4) {
		return {
			severity: 'critical',
			title: 'Update failed and the rollback could not reinstall — the app may be OFFLINE',
			detail:
				'The previous version could not be restored from npm. SSH into the ' +
				'server and run `pm2 logs selva-compute`; if the app is down, reinstall ' +
				'explicitly with `npm install --prefer-online @selvajs/cli@<version> ' +
				'@selvajs/selva@<version>` from the deployment directory.',
			from,
			to
		};
	}
	// Exit 3: unhealthy with no recorded prior version, so no rollback was even
	// attempted. The EXIT trap tried to restart whatever is on disk.
	if (exitCode === 3) {
		return {
			severity: 'critical',
			title: 'Update failed its health check and could not be rolled back automatically',
			detail:
				'No prior version was recorded, so the previous build could not be ' +
				'restored. Check `pm2 logs selva-compute` to confirm whether the app ' +
				'came back online.',
			from,
			to
		};
	}

	// Killed mid-run (128+signal). Nothing was installed, and whether the app
	// came back depends on how far the EXIT trap got before it died too. Rank
	// with the criticals: an unattended half-update is worse than a clean
	// failure.
	if (exitCode === 143 || exitCode === 130 || exitCode === 129 || has(logs, 'KILLED')) {
		return {
			severity: 'critical',
			title: 'Update was killed before it finished — nothing was installed',
			detail:
				'The runner was terminated mid-update, most often by a systemd-supervised ' +
				'PM2 restarting its whole control group. The version on disk is unchanged. ' +
				'Check `pm2 logs selva-compute` and confirm the app is online before retrying; ' +
				'if a global pm2 owns the daemon, reconcile that first.',
			from,
			to
		};
	}

	// --- Warning: update did not fully succeed, but the app IS up. ------------
	// Aborted at the systemd guard, before `pm2 update` could recycle the
	// daemon and take this runner down with it.
	if (exitCode === 9 || has(logs, 'SYSTEMD_PM2')) {
		return {
			severity: 'warning',
			title:
				'Update cancelled — PM2 needs a resync that only a shell can do safely. The app is untouched.',
			detail:
				"This deployment's PM2 runs under systemd, where `pm2 update` restarts the " +
				'unit and kills the update mid-run. Nothing was installed and the app is ' +
				'still serving. SSH in and run `./node_modules/.bin/pm2 update` from the ' +
				'deployment directory, then retry the update here.',
			from,
			to
		};
	}
	// Aborted at the pm2 skew check, before anything was stopped — nothing was
	// installed and the app never went down.
	if (exitCode === 8 || has(logs, 'PM2_SKEW')) {
		const daemon = firstMatch(logs, /daemon \(v(\d+\.\d+\.\d+)\)/);
		const local = firstMatch(logs, /deployment's pm2 \(v(\d+\.\d+\.\d+)\)/);
		return {
			severity: 'warning',
			title:
				daemon && local
					? `Update cancelled — a global PM2 (v${daemon}) owns the daemon, not this deployment's (v${local}). The app is untouched.`
					: 'Update cancelled — a conflicting global PM2 owns the daemon. The app is untouched.',
			detail:
				'Resyncing would have downgraded the daemon and dropped its process ' +
				'table, so the update stopped before taking the app down. On the server: ' +
				'`which -a pm2`, `pm2 -v`, `pm2 ping` — remove or align the global pm2, then retry.',
			from,
			to
		};
	}
	// A rollback whose cause is the DATABASE, not the release. Ranked ahead of
	// the generic rollback case: "review the log before retrying" is actively
	// misleading here, because the log holds nothing about the new version —
	// it is fine, and retrying without touching the database repeats verbatim.
	if (has(logs, 'SCHEMA_SKEW')) {
		const expected = firstMatch(logs, /expects database migration head (\S+?),/);
		const actual = firstMatch(logs, /this database is at (\S+?)\./);
		const skew =
			expected && actual ? ` The database is at ${actual}; ${to ?? 'it'} needs ${expected}.` : '';
		return {
			severity: 'warning',
			title: `Update rolled back — the database migrations for ${to ?? 'the new version'} have not been applied.${skew} The app is online${from ? ` on ${from}` : ''}.`,
			detail:
				'Nothing is wrong with the new version. Selva does not apply migrations ' +
				'during an update, because they cannot be rolled back — auto-migrating ' +
				'and then rolling the code back would leave the app and database on ' +
				'different heads. Apply them on the server, then re-run this update: ' +
				'`npm install --prefer-online @selvajs/supabase-provider@latest`, then ' +
				'`npx selva-supabase`, then `npx supabase db push`. The provider install ' +
				'is not optional — the migration SQL ships inside that package, and the ' +
				'rollback pinned it back to the old version, so a sync without it copies ' +
				'nothing and the push reports "up to date" having done nothing. ' +
				'Retrying without this will fail in exactly the same way.',
			from,
			to
		};
	}
	// Same shape: the rollback was caused by host configuration, not the release.
	if (has(logs, 'AT_REST_SECRETS')) {
		return {
			severity: 'warning',
			title: `Update rolled back — stored compute server keys do not decrypt under this host's SELVA_AT_REST_KEY. The app is online${from ? ` on ${from}` : ''}.`,
			detail:
				'This is a configuration problem on the server, not a fault in the new ' +
				'version, so retrying alone will fail identically. Re-enter the affected ' +
				'keys at /admin/compute, or restore the SELVA_AT_REST_KEY the values were ' +
				'encrypted with, then re-run the update.',
			from,
			to
		};
	}
	if (exitCode === 5 || has(logs, 'Rolled back')) {
		return {
			severity: 'warning',
			title: `Update failed — safely rolled back${from ? ` to ${from}` : ''}. The app is online.`,
			detail:
				'The new version failed its health check, so the previous version ' +
				'was restored and is serving normally. Review the log below for why ' +
				'the new version failed before retrying.',
			from,
			to
		};
	}
	// The install completed and the app is up, but on a Node the release doesn't
	// support. The health probe passes (it exercises nothing version-specific),
	// so this would otherwise read as a clean success right up until a real
	// request hits a newer API and throws (issue #176).
	if (has(logs, 'ENGINE_MISMATCH') || has(logs, 'EBADENGINE')) {
		const required = firstMatch(logs, /requires Node ([^\s]+(?:\s*[<>=]+\s*[\d.]+)*)/);
		const running = firstMatch(logs, /this host runs v?(\d+\.\d+\.\d+)/);
		return {
			severity: 'warning',
			title: running
				? `Updated${to ? ` to ${to}` : ''}, but this release needs Node ${required ?? '(newer)'} — the host runs v${running}. Expect runtime failures.`
				: `Updated${to ? ` to ${to}` : ''}, but this release requires a newer Node than the host provides. Expect runtime failures.`,
			detail:
				'npm installed it anyway (engine-strict is off) and the health check ' +
				'passed, but it does not exercise the newer APIs — routes that do will ' +
				'throw at request time. Upgrade Node on the server, then re-run the update.',
			from,
			to
		};
	}
	if (has(logs, 'npm cache may be stale') || has(logs, 'No version change')) {
		return {
			severity: 'warning',
			title: 'No version change — npm installed the same version.',
			detail:
				'Your npm cache may be stale. On the server: `npm cache clean --force`, ' +
				'remove node_modules + package-lock.json, then `npm install --prefer-online`.',
			from,
			to
		};
	}

	// --- Success variants -----------------------------------------------------
	if (exitCode === 0) {
		// "Already on the 'beta' channel version (4.2.0)" — the channel name is
		// interpolated, so match the stable prefix rather than a whole line.
		if (has(logs, 'Already on the') || has(logs, 'Nothing to do')) {
			return {
				severity: 'info',
				title: `Already up to date${from ? ` (${from})` : ''} — nothing to install.`,
				detail: 'No changes were made and the app was not restarted.',
				from,
				to
			};
		}
		if (from && to && from !== to) {
			return {
				severity: 'success',
				title: `Updated ${from} → ${to}. The app is back online.`,
				from,
				to
			};
		}
		if (to) {
			return {
				severity: 'success',
				title: `Update complete — now on ${to}. The app is back online.`,
				from,
				to
			};
		}
		return {
			severity: 'success',
			title: 'Update completed and the app is back online.',
			from,
			to
		};
	}

	// --- Anything else: a non-zero exit we don't have a named case for. -------
	// Be explicit that we couldn't classify it rather than implying success.
	return {
		severity: 'critical',
		title: `Update failed (exit code ${exitCode}).`,
		detail:
			'The update did not complete cleanly. Review the log below, and check ' +
			'`pm2 logs selva-compute` to confirm whether the app is currently online.',
		from,
		to
	};
}
