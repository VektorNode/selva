#!/usr/bin/env node

// ============================================================================
// Promote beta to stable
// ============================================================================
//
//   pnpm release:promote [--dry-run] [--yes]
//
// Exits pre mode on beta, pushes, and opens the beta → main PR with auto-merge
// set to a merge commit. From there it is automatic: release.yml opens the
// version PR on main, merging that publishes to `latest`, and release.yml then
// merges main back into beta and re-enters pre mode.
//
// The PR must land as a merge commit. A squash gives main a copy of beta's
// history under a new hash, so beta never sees it as merged and the next
// promotion conflicts in every version line beta bumped since.
//
// Runs as you, not as a bot: a push or PR made with the Actions token starts no
// CI, and main's ruleset requires CI.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const preJsonPath = join(repoRoot, '.changeset', 'pre.json');

const args = process.argv.slice(2);
const KNOWN_FLAGS = ['--dry-run', '--yes', '-y', '--help', '-h'];
const DRY_RUN = args.includes('--dry-run');
const ASSUME_YES = args.includes('--yes') || args.includes('-y');

if (args.includes('--help') || args.includes('-h')) {
	console.log(`Promote beta to stable: exit pre mode, push, open the beta → main PR.

Usage:
  pnpm release:promote [options]

Options:
  --dry-run    check everything and print what would happen; change nothing
  --yes, -y    skip the confirmation prompt
  --help, -h   show this help`);
	process.exit(0);
}

const unknownFlag = args.find((a) => !KNOWN_FLAGS.includes(a));
if (unknownFlag) die(`Unknown option "${unknownFlag}". Nothing was changed.`);

// ============================================================================
// Helpers
// ============================================================================

function die(msg) {
	console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
	process.exit(1);
}

function warn(msg) {
	console.warn(`\x1b[33m! ${msg}\x1b[0m`);
}

// Read-only: runs under --dry-run too.
function read(cmd, cmdArgs) {
	return execFileSync(cmd, cmdArgs, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function succeeds(cmd, cmdArgs) {
	return spawnSync(cmd, cmdArgs, { cwd: repoRoot, stdio: 'ignore' }).status === 0;
}

// pnpm is pnpm.cmd on Windows and needs a shell. A shell does not escape args,
// so only pass `shell` for calls whose args contain no spaces.
function write(cmd, cmdArgs, { shell = false } = {}) {
	if (DRY_RUN) {
		console.log(`  [dry-run] ${cmd} ${cmdArgs.join(' ')}`);
		return '';
	}
	return execFileSync(cmd, cmdArgs, { cwd: repoRoot, stdio: 'inherit', encoding: 'utf8', shell });
}

function ask(question) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) =>
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim().toLowerCase());
		})
	);
}

function preMode() {
	if (!existsSync(preJsonPath)) return null;
	return JSON.parse(readFileSync(preJsonPath, 'utf8')).mode;
}

// ============================================================================
// Preflight
// ============================================================================

if (!succeeds('gh', ['auth', 'status'])) die('GitHub CLI is not logged in. Run `gh auth login`.');
if (read('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'beta') die('Check out beta first.');
if (read('git', ['status', '--porcelain']))
	die('Working tree is not clean. Commit or stash first.');

read('git', ['fetch', 'origin', 'main', 'beta']);

const [ahead, behind] = read('git', ['rev-list', '--left-right', '--count', 'HEAD...origin/beta'])
	.split(/\s+/)
	.map(Number);
if (ahead > 0 && behind > 0) die('Local beta and origin/beta have diverged. Pull first.');

// The plan below reads the working tree, and release.yml pushes a version commit
// after most beta pushes, so local beta is usually behind.
if (behind > 0) {
	if (DRY_RUN)
		die(
			`Local beta is ${behind} commit(s) behind origin/beta. Run \`git pull --ff-only\`, then dry-run again.`
		);
	console.log(`Fast-forwarding local beta by ${behind} commit(s).`);
	write('git', ['merge', '--ff-only', 'origin/beta']);
}

const mode = preMode();
if (mode === null)
	die('.changeset/pre.json is missing: beta is not in pre mode, so there is nothing to promote.');

// Changesets in the root were never released as a beta; exiting pre mode ships them straight to stable.
const unreleased = read('node', ['scripts/release/unconsumed-changesets.mjs'])
	.split('\n')
	.filter(Boolean);

// Stable version = the beta version without its prerelease suffix. Unreleased
// changesets can still raise a bump, so this is the floor, not a promise.
const promoted = read('node', ['scripts/release/publishable-packages.mjs', '--list'])
	.split('\n')
	.map((line) => line.split('\t'))
	.filter(([, version]) => version?.includes('-'))
	.map(([name, version]) => `${name} ${version.replace(/-.*$/, '')}`);

const containsMain = succeeds('git', ['merge-base', '--is-ancestor', 'origin/main', 'HEAD']);

console.log('\nPromote beta → main');
if (!containsMain) console.log('  · merge origin/main into beta (main has commits beta lacks)');
if (mode === 'pre') console.log('  · pnpm changeset pre exit, commit');
else console.log('  · pre mode already exiting, no commit needed');
console.log('  · push beta, open the PR, enable auto-merge as a merge commit');
console.log(`\nReleases: ${promoted.length ? promoted.join(', ') : '(no beta versions found)'}`);
if (unreleased.length) {
	warn(`Never released as a beta, will ship straight to stable: ${unreleased.join(', ')}`);
}

if (!DRY_RUN && !ASSUME_YES && (await ask('\nContinue? [y/N] ')) !== 'y')
	die('Aborted. Nothing was pushed.');

// ============================================================================
// Promote
// ============================================================================

if (!containsMain) {
	if (DRY_RUN) {
		console.log('  [dry-run] git merge --no-edit origin/main');
	} else if (!succeeds('git', ['merge', '--no-edit', 'origin/main'])) {
		const conflicts = read('git', ['diff', '--name-only', '--diff-filter=U']);
		read('git', ['merge', '--abort']);
		die(
			`origin/main does not merge cleanly into beta. Nothing was pushed.\n\n${conflicts}\n\n` +
				'Merge it by hand (git merge origin/main), resolve, commit, then run this again.'
		);
	}
}

if (mode === 'pre') {
	write('pnpm', ['changeset', 'pre', 'exit'], { shell: true });
	write('git', ['add', '.changeset/pre.json']);
	write('git', ['commit', '-m', 'chore: exit beta pre mode']);
}

write('git', ['push', 'origin', 'HEAD:beta']);

const title =
	promoted.length > 0 && promoted.length <= 3
		? `Release ${promoted.join(', ')}`
		: `Release beta to stable (${promoted.length} packages)`;
const body = [
	'Promotes beta to stable. Opened by `pnpm release:promote`.',
	'',
	'Merge as a **merge commit**, never squash: a squash makes the next promotion conflict.',
	'After this merges, merge the "chore: version packages" PR to publish. beta re-enters pre mode on its own.'
].join('\n');

let pr = read('gh', [
	'pr',
	'list',
	'--base',
	'main',
	'--head',
	'beta',
	'--state',
	'open',
	'--json',
	'url',
	'--jq',
	'.[0].url'
]);
if (pr) {
	console.log(`Reusing open PR ${pr}`);
} else if (DRY_RUN) {
	console.log(`  [dry-run] gh pr create --base main --head beta --title "${title}"`);
} else {
	pr = read('gh', [
		'pr',
		'create',
		'--base',
		'main',
		'--head',
		'beta',
		'--title',
		title,
		'--body',
		body
	]);
	console.log(`Opened ${pr}`);
}

if (DRY_RUN) {
	console.log('  [dry-run] gh pr merge --auto --merge');
	process.exit(0);
}

const merge = spawnSync('gh', ['pr', 'merge', pr, '--auto', '--merge'], {
	cwd: repoRoot,
	encoding: 'utf8'
});
if (merge.status !== 0) {
	die(
		`Could not enable auto-merge as a merge commit on ${pr}:\n\n` +
			`${(merge.stderr || merge.stdout || '').trim()}\n\n` +
			'If gh names the merge method: the main ruleset must allow merge commits (Settings → Rules →\n' +
			'main: add "Merge" to allowed merge methods, turn off "Require linear history").\n' +
			'Either way, merge this PR as a merge commit, never squash.'
	);
}

console.log(`\n✓ ${pr} merges itself once CI passes.`);
console.log('  Then merge the "chore: version packages" PR on main to publish.');
