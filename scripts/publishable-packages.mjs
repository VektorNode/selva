#!/usr/bin/env node

// ============================================================================
// Workspace publish source-of-truth + invariant guard
// ============================================================================
//
// One script, two modes:
//
//   --list   Print every publishable (private !== true) workspace package as
//            `name<TAB>version<TAB>relativeDir`. The release workflow iterates
//            this instead of a hardcoded `selva cli ui schemas` list, so a
//            provider-/platform-only bump actually triggers a publish (the old
//            list silently skipped those — the very packages external
//            consumers pull from npm).
//
//   --check  Assert the versioning model's invariants and exit non-zero on
//            violation. Runs in PR CI so the model can't silently regress.
//
// Dependency-free on purpose: the release workflow runs this with the runner's
// system node BEFORE `pnpm install`, so it can only use Node built-ins. It
// derives the package list from pnpm-workspace.yaml + the filesystem.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ============================================================================
// Workspace discovery
// ============================================================================

// Extract the `packages:` list from pnpm-workspace.yaml. We can't pull in a
// YAML parser (no deps), but the block is a simple `- <glob>` list. A tiny
// state machine scoped to the `packages:` top-level key avoids picking up the
// `- esbuild` items under `onlyBuiltDependencies:`.
function readWorkspaceGlobs() {
	const yaml = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
	const globs = [];
	let inPackages = false;
	for (const line of yaml.split('\n')) {
		const topLevel = line.match(/^([A-Za-z][\w-]*):/);
		if (topLevel) {
			inPackages = topLevel[1] === 'packages';
			continue;
		}
		if (!inPackages) continue;
		const item = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
		if (item) globs.push(item[1]);
	}
	if (globs.length === 0) throw new Error('No package globs found in pnpm-workspace.yaml');
	return globs;
}

// Expand a workspace glob to package directories. We only support the single
// trailing `/*` wildcard (all this repo uses) plus literal paths.
function expandGlob(glob) {
	if (glob.endsWith('/*')) {
		const parent = join(repoRoot, glob.slice(0, -2));
		if (!existsSync(parent)) return [];
		return readdirSync(parent, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => join(parent, d.name))
			.filter((dir) => existsSync(join(dir, 'package.json')));
	}
	const dir = join(repoRoot, glob);
	return existsSync(join(dir, 'package.json')) ? [dir] : [];
}

function readWorkspacePackages() {
	const dirs = new Set();
	for (const glob of readWorkspaceGlobs()) {
		for (const dir of expandGlob(glob)) dirs.add(dir);
	}
	return [...dirs].map((dir) => {
		const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
		return {
			name: pkg.name,
			version: pkg.version,
			private: pkg.private === true,
			dir,
			relDir: relative(repoRoot, dir).replace(/\\/g, '/'),
			dependencies: pkg.dependencies ?? {},
			devDependencies: pkg.devDependencies ?? {},
			publishConfig: pkg.publishConfig ?? {}
		};
	});
}

// ============================================================================
// Modes
// ============================================================================

function list(packages) {
	for (const p of packages) {
		if (p.private) continue;
		process.stdout.write(`${p.name}\t${p.version}\t${p.relDir}\n`);
	}
}

function check(packages) {
	const byName = new Map(packages.map((p) => [p.name, p]));
	const isWorkspace = (name) => byName.has(name);
	const violations = [];

	for (const p of packages) {
		// (1) Publishable packages must declare access explicitly.
		if (!p.private && p.publishConfig.access !== 'public') {
			violations.push(
				`${p.name} is publishable (private!=true) but has no publishConfig.access:"public"`
			);
		}

		// (2) A published package must not have a RUNTIME dependency on a
		// private (never-published) workspace package — that produces an
		// uninstallable package on npm. devDependencies are fine (bundled).
		if (!p.private) {
			for (const dep of Object.keys(p.dependencies)) {
				const target = byName.get(dep);
				if (target && target.private) {
					violations.push(
						`${p.name} (publishable) has a runtime dependency on ${dep}, which is private — it would be unresolvable on npm. Move it to devDependencies or publish it.`
					);
				}
			}
		}
	}

	// (3) @selvajs/selva is a self-contained bundle: its workspace siblings
	// (ui/schemas/providers/platform) are compiled into build/ as
	// devDependencies. A workspace @selvajs/* leaking into selva's runtime
	// `dependencies` means the published bundle would resolve that lib from
	// npm and could drift from what it was built and tested against — breaking
	// the "newest selva = newest ui baked in" guarantee. (External npm deps
	// like @selvajs/compute are not workspace packages and are allowed.)
	const selva = byName.get('@selvajs/selva');
	if (selva) {
		for (const dep of Object.keys(selva.dependencies)) {
			if (isWorkspace(dep)) {
				violations.push(
					`@selvajs/selva must stay a self-contained bundle, but has workspace package ${dep} in runtime dependencies. Move it to devDependencies so it is bundled, not resolved from npm.`
				);
			}
		}
	}

	// (4) @selvajs/selva and @selvajs/cli must release in lockstep so their
	// MAJOR versions stay aligned — `selva doctor` errors on a cli/runtime
	// major mismatch. Enforce that they share a `fixed` changeset group.
	const fixedGroups = readChangesetFixedGroups();
	const sameGroup = fixedGroups.some(
		(g) => g.includes('@selvajs/selva') && g.includes('@selvajs/cli')
	);
	if (!sameGroup) {
		violations.push(
			'@selvajs/selva and @selvajs/cli must be in the same changeset "fixed" group (.changeset/config.json) to keep their major versions aligned for `selva doctor`.'
		);
	}

	if (violations.length > 0) {
		console.error('✗ publishable-packages invariant check failed:\n');
		for (const v of violations) console.error('  · ' + v);
		console.error('');
		process.exit(1);
	}
	console.log('✓ publishable-packages invariants hold');
}

function readChangesetFixedGroups() {
	const configPath = join(repoRoot, '.changeset', 'config.json');
	if (!existsSync(configPath)) return [];
	const config = JSON.parse(readFileSync(configPath, 'utf8'));
	return Array.isArray(config.fixed) ? config.fixed : [];
}

// ============================================================================
// Entry
// ============================================================================

const mode = process.argv[2];
const packages = readWorkspacePackages().sort((a, b) => a.name.localeCompare(b.name));

if (mode === '--list') {
	list(packages);
} else if (mode === '--check') {
	check(packages);
} else {
	console.error('Usage: node scripts/publishable-packages.mjs --list | --check');
	process.exit(2);
}
