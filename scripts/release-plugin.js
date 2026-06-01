#!/usr/bin/env node

/**
 * Plugin release helper.
 *
 * Bumps the Grasshopper plugin version (the single source of truth is
 * Selva.GH.csproj <Version>, mirrored into AssemblyVersion / FileVersion /
 * InformationalVersion), commits the bump, creates a `plugin-v<x.y.z>` tag, and
 * pushes. Pushing the tag triggers .github/workflows/plugin-release.yml, which
 * verifies the tag matches the csproj version, builds the multi-target .gha /
 * .yak packages, pushes to the Yak registry, and cuts a GitHub Release.
 *
 * Usage:
 *   node scripts/release-plugin.js [major|minor|patch|<x.y.z>] [options]
 *
 *   (no bump arg)   prompt interactively for major / minor / patch
 *   major|minor|patch   bump that part of the current version
 *   <x.y.z>             set an explicit version
 *
 * Options:
 *   --build      run `pnpm build:plugin` locally before tagging (verification;
 *                CI builds anyway, so this is opt-in)
 *   --no-push    commit and tag locally, but don't push (you push when ready)
 *   --dry-run    print every action without changing anything
 *   --yes, -y    skip the final confirmation prompt
 *   --help, -h   show this help
 *
 * Cross-platform (Windows, macOS, Linux).
 */

import { readFileSync, writeFileSync } from 'fs'; // readFileSync: csproj; writeFileSync: bump
import { execFileSync } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const csprojPath = path.join(projectRoot, 'Plugin', 'Selva.GH', 'Selva.GH.csproj');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

if (flag('--help') || flag('-h')) {
	console.log(`Plugin release helper — bump version, commit, tag, push.

Usage:
  pnpm release:plugin [major|minor|patch|<x.y.z>] [options]

  (no bump arg)        prompt for major / minor / patch
  major|minor|patch    bump that part of the current version
  <x.y.z>              set an explicit version

Options:
  --build      run \`pnpm build:plugin\` locally before tagging (CI builds anyway)
  --no-push    commit and tag locally, but don't push
  --dry-run    print every action without changing anything
  --yes, -y    skip the final confirmation prompt
  --help, -h   show this help

Pushing the plugin-v<x.y.z> tag triggers .github/workflows/plugin-release.yml,
which builds the multi-target .gha/.yak, publishes to Yak, and cuts a Release.`);
	process.exit(0);
}

const DRY_RUN = flag('--dry-run');
const NO_PUSH = flag('--no-push');
const BUILD = flag('--build');
const ASSUME_YES = flag('--yes') || flag('-y');
const bumpArg = args.find((a) => !a.startsWith('-'));

// ============================================================================
// Helpers
// ============================================================================

function die(msg) {
	console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
	process.exit(1);
}

function info(msg) {
	console.log(msg);
}

function run(cmd, cmdArgs, { capture = false } = {}) {
	if (DRY_RUN) {
		info(`  [dry-run] ${cmd} ${cmdArgs.join(' ')}`);
		return '';
	}
	return execFileSync(cmd, cmdArgs, {
		cwd: projectRoot,
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8'
	});
}

function ask(question) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	return new Promise((resolve) =>
		rl.question(question, (answer) => {
			rl.close();
			resolve(answer.trim());
		})
	);
}

function parseVersion(v) {
	const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
	if (!m) die(`Version "${v}" is not in x.y.z form.`);
	return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function bump(current, kind) {
	const { major, minor, patch } = parseVersion(current);
	if (kind === 'major') return `${major + 1}.0.0`;
	if (kind === 'minor') return `${major}.${minor + 1}.0`;
	if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
	parseVersion(kind); // explicit version — validate
	return kind;
}

// ============================================================================
// Read current version
// ============================================================================

const csproj = readFileSync(csprojPath, 'utf8');
const currentMatch = /<Version>(.*?)<\/Version>/.exec(csproj);
if (!currentMatch) die('Could not find <Version> in Selva.GH.csproj.');
const currentVersion = currentMatch[1].trim();

// ============================================================================
// Determine target version
// ============================================================================

let targetVersion;
if (bumpArg) {
	targetVersion = bump(currentVersion, bumpArg);
} else {
	info(`Current plugin version: \x1b[1m${currentVersion}\x1b[0m`);
	const choice = (
		await ask(
			`Bump which part? [${['patch', 'minor', 'major']
				.map((k) => `${k} → ${bump(currentVersion, k)}`)
				.join(', ')}] (patch): `
		)
	).toLowerCase();
	const kind = choice || 'patch';
	if (!['major', 'minor', 'patch'].includes(kind)) {
		// allow typing an explicit version at the prompt too
		parseVersion(kind);
	}
	targetVersion = bump(currentVersion, kind);
}

if (targetVersion === currentVersion) die(`Target version equals current (${currentVersion}).`);

const tag = `plugin-v${targetVersion}`;

// ============================================================================
// Preflight: clean tree, tag not already taken
// ============================================================================

let status = '';
try {
	status = execFileSync('git', ['status', '--porcelain'], {
		cwd: projectRoot,
		encoding: 'utf8'
	});
} catch {
	die('Not a git repository (or git not available).');
}
if (status.trim() && !DRY_RUN) {
	die('Working tree is not clean. Commit or stash changes before releasing.');
}

const existingTags = execFileSync('git', ['tag', '--list', tag], {
	cwd: projectRoot,
	encoding: 'utf8'
}).trim();
if (existingTags) die(`Tag ${tag} already exists.`);

// Release off main, and only when in sync with the remote — otherwise the final
// `git push` can be rejected, leaving a local tag for a version that never ships.
// Skipped under --dry-run (the fetch hits the network and nothing gets pushed).
if (!DRY_RUN) {
	const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
		cwd: projectRoot,
		encoding: 'utf8'
	}).trim();
	if (branch !== 'main') {
		die(`On branch "${branch}", not "main". Releases are cut from main.`);
	}

	try {
		execFileSync('git', ['fetch', 'origin', 'main', '--quiet'], { cwd: projectRoot });
	} catch {
		die('Could not fetch origin/main. Check your network/remote.');
	}
	const local = execFileSync('git', ['rev-parse', 'HEAD'], {
		cwd: projectRoot,
		encoding: 'utf8'
	}).trim();
	const remote = execFileSync('git', ['rev-parse', 'origin/main'], {
		cwd: projectRoot,
		encoding: 'utf8'
	}).trim();
	if (local !== remote) {
		die('Local main is not in sync with origin/main. Pull/push so they match, then retry.');
	}
}

// ============================================================================
// Confirm
// ============================================================================

info('');
info(`  Plugin release plan`);
info(`  ───────────────────`);
info(`  version : ${currentVersion} → \x1b[1m${targetVersion}\x1b[0m`);
info(`  tag     : ${tag}`);
info(`  build   : ${BUILD ? 'yes (pnpm build:plugin)' : 'no (CI builds on tag push)'}`);
info(`  push    : ${NO_PUSH ? 'no (local only)' : 'yes (triggers plugin-release.yml)'}`);
info('');

if (!ASSUME_YES && !DRY_RUN) {
	const ok = (await ask('Proceed? (y/N): ')).toLowerCase();
	if (ok !== 'y' && ok !== 'yes') die('Aborted.');
}

// ============================================================================
// Apply: bump all four version tags
// ============================================================================

// Replace each tag, asserting the pattern matched exactly once. A silent no-op
// (tag renamed, removed, or using an MSBuild expression) would otherwise commit a
// partial bump where some version fields disagree.
function replaceTag(text, tag, value) {
	const re = new RegExp(`<${tag}>.*?</${tag}>`, 'g');
	const matches = text.match(re);
	if (!matches) die(`<${tag}> not found in Selva.GH.csproj — cannot bump it safely.`);
	if (matches.length > 1)
		die(`<${tag}> appears ${matches.length}× in Selva.GH.csproj — ambiguous.`);
	return text.replace(re, `<${tag}>${value}</${tag}>`);
}

let updated = csproj;
updated = replaceTag(updated, 'Version', targetVersion);
updated = replaceTag(updated, 'AssemblyVersion', `${targetVersion}.0`);
updated = replaceTag(updated, 'FileVersion', `${targetVersion}.0`);
updated = replaceTag(updated, 'InformationalVersion', targetVersion);

if (DRY_RUN) {
	info(`  [dry-run] write ${path.relative(projectRoot, csprojPath)} with version ${targetVersion}`);
} else {
	writeFileSync(csprojPath, updated);
	info(`✓ Bumped Selva.GH.csproj to ${targetVersion}`);
}

// ============================================================================
// Optional local build
// ============================================================================

if (BUILD) {
	info('→ Building plugin (pnpm build:plugin)…');
	run('pnpm', ['run', 'build:plugin']);
}

// ============================================================================
// Commit, tag, push
// ============================================================================

run('git', ['add', path.relative(projectRoot, csprojPath)]);
run('git', ['commit', '-m', `chore(plugin): release ${targetVersion}`]);
run('git', ['tag', tag, '-m', `Selva Plugin ${targetVersion}`]);
info(`✓ Committed and tagged ${tag}`);

if (NO_PUSH) {
	info('');
	info(`Tag created locally. Push when ready:`);
	info(`  git push --follow-tags`);
} else {
	run('git', ['push', '--follow-tags']);
	info(`✓ Pushed — plugin-release.yml will build and publish ${tag}.`);
}
