#!/usr/bin/env node

// Publish-time gate + tarball cleanup, run as each published package's `prepack`
// (with the paired `postpack` restoring the source tree). Two jobs:
//
//   1. Gate — `publint --strict` fails the pack on real export/file/types drift.
//      Packages with many subpath exports (platform: 17, server: 9) are the most
//      exposed to a rename that breaks one export map entry; this makes that a
//      hard error at publish, not a silent ship.
//
//   2. Strip the `source` export condition (and the `src/` it points at) from the
//      PUBLISHED package.json. In the monorepo, `source` lets vitest read a
//      workspace package's raw TypeScript directly (resolve.conditions:['source'])
//      so there's no rebuild between editing a type and running tests. Consumers
//      of the npm package have no business resolving our raw `.ts` — it only fires
//      under an opt-in customCondition, but it's a sharp edge (and drags `src/`
//      into the tarball for no runtime reason). We keep `source` in the committed
//      package.json (dev inner-loop untouched) and remove it only from what ships.
//
// Mechanism: prepack rewrites package.json in place after backing it up to
// `package.json.prepack-bak`; postpack restores from the backup. prepack also
// restores a stale backup first, so a crashed prior run self-heals on the next.
//
// Usage (per package.json):
//   "prepack":  "node ../../scripts/prepack.js",
//   "postpack": "node ../../scripts/prepack.js --restore"
// (adjust the relative path to scripts/ per package depth).

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const PKG = path.resolve(process.cwd(), 'package.json');
const BAK = path.resolve(process.cwd(), 'package.json.prepack-bak');

function restore() {
	if (fs.existsSync(BAK)) {
		fs.copyFileSync(BAK, PKG);
		fs.rmSync(BAK);
	}
}

// ── postpack: put the source tree back ──────────────────────────────────────
if (process.argv.includes('--restore')) {
	restore();
	process.exit(0);
}

// ── prepack ─────────────────────────────────────────────────────────────────

// Self-heal: if a previous prepack crashed before postpack ran, the working
// package.json is the mutated one and BAK holds the original. Restore first so
// we lint + re-strip from a clean base.
restore();

// 1. Gate. Run publint via its JS bin resolved from node_modules so we spawn a
// plain `node <script>` — no shell, so this is identical on Windows and POSIX and
// doesn't depend on `.cmd` vs `.CMD` bin shims. Resolve relative to THIS script
// (scripts/ sits at the repo root, whose node_modules has publint hoisted) — the
// individual packages don't depend on publint, so resolving from their cwd fails
// under pnpm's isolated node_modules.
const require = createRequire(import.meta.url);
let publintBin;
try {
	// publint's package.json isn't in its `exports`, so resolve the main entry and
	// walk up to the package root, then read `bin` from there.
	let dir = path.dirname(require.resolve('publint'));
	while (!fs.existsSync(path.join(dir, 'package.json'))) {
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error('publint package root not found');
		dir = parent;
	}
	const { bin } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
	const rel = typeof bin === 'string' ? bin : bin.publint;
	publintBin = path.resolve(dir, rel);
} catch {
	console.error('prepack: could not resolve the publint binary from the workspace root.');
	process.exit(1);
}
try {
	execFileSync(process.execPath, [publintBin, '--strict'], { stdio: 'inherit' });
} catch {
	process.exit(1);
}

// 2. Strip `source` from the published exports + drop `src` from `files`.
const original = fs.readFileSync(PKG, 'utf8');
const pkg = JSON.parse(original);

let changed = false;

// Recursively delete every `source` condition key in the exports map.
const stripSource = (node) => {
	if (!node || typeof node !== 'object') return;
	if ('source' in node) {
		delete node.source;
		changed = true;
	}
	for (const key of Object.keys(node)) stripSource(node[key]);
};
if (pkg.exports) stripSource(pkg.exports);

// `src/` is only in `files` to serve the `source` condition (verified: no
// non-source export target resolves into src/). ui is the exception — it ships
// src/lib for its ./styles/*.css + svelte source — so this script is NOT wired
// into ui, and any `src`-shaped entry here is safe to drop.
if (Array.isArray(pkg.files)) {
	const before = pkg.files.length;
	pkg.files = pkg.files.filter((f) => f !== 'src' && f !== 'src/**');
	if (pkg.files.length !== before) changed = true;
}

if (changed) {
	fs.copyFileSync(PKG, BAK);
	// Preserve trailing-newline / tab style: reserialize with tabs (repo default).
	const trailing = original.endsWith('\n') ? '\n' : '';
	fs.writeFileSync(PKG, JSON.stringify(pkg, null, '\t') + trailing);
}
