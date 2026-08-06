// The shape every `selva doctor` check returns, and the repair a check may
// carry. Kept apart from the checks themselves so a pure predicate can be
// tested without pulling in the filesystem and network ones.

import pc from 'picocolors';

export function green(text) {
	return { severity: 'green', line: `${pc.green('✓')} ${text}` };
}
export function yellow(text, fix) {
	return { severity: 'yellow', line: `${pc.yellow('!')} ${text}`, fix };
}
export function red(text, fix) {
	return { severity: 'red', line: `${pc.red('✗')} ${text}`, fix };
}

/**
 * A repair `--fix` may run. `label` is what the operator is asked to approve;
 * `run()` performs it and returns a result line.
 *
 * Only attach one where the repair is unambiguous and reversible-ish. Anything
 * needing root, or that restarts the runtime running this process, stays a
 * printed instruction — a half-applied privileged fix is worse than none.
 */
export function fixable(label, run) {
	return { label, run };
}
