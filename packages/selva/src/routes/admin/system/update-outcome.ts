// ============================================================================
// Update-outcome derivation
// ============================================================================
//
// The update runner (admin/api/system/update/+server.ts) emits structured log
// lines and a small set of meaningful exit codes. The UI MUST NOT collapse
// those into a vague "succeeded / failed" — an operator has to be able to tell,
// at a glance and unambiguously:
//
//   • whether anything actually changed (and from which version to which),
//   • whether the app is UP or DOWN right now,
//   • whether a failed update was safely rolled back (app fine) vs left the
//     app offline (urgent), and
//   • the exact next action when something is wrong.
//
// `deriveOutcome` is a pure function of (exitCode, logs) so it's testable in
// isolation and can never silently mislead. Severity ranking — anything that
// leaves the app DOWN is `critical`; a safe rollback is `warning`, not an
// error, because the site is still serving.

export type OutcomeSeverity = 'success' | 'info' | 'warning' | 'critical' | 'pending';

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

/** Extract the before/after runtime versions the runner prints, if present. */
function parseVersions(logs: string): { from?: string; to?: string } {
	// "[INFO] Available: 4.2.0 → 4.2.1"  (the arrow may be → or ->)
	const avail = /Available:\s*(\d+\.\d+\.\d+[^\s]*)\s*(?:→|->)\s*(\d+\.\d+\.\d+[^\s]*)/.exec(logs);
	if (avail) return { from: avail[1], to: avail[2] };
	const from = firstMatch(logs, /Current @selvajs\/selva:\s*v?(\d+\.\d+\.\d+[^\s]*)/);
	const to = firstMatch(logs, /New @selvajs\/selva:\s*v?(\d+\.\d+\.\d+[^\s]*)/);
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
	if (exitCode === -2) {
		return {
			severity: 'critical',
			title: 'App did not come back online within 5 minutes',
			detail:
				'The update may still be finishing in the background, or the new ' +
				'process is crash-looping. Check `pm2 logs selva-compute`. Do not ' +
				're-run the update until you have confirmed the current state.',
			from,
			to
		};
	}

	// --- Warning: update did not fully succeed, but the app IS up. ------------
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
		if (has(logs, 'Already on the latest version') || has(logs, 'Nothing to do')) {
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
