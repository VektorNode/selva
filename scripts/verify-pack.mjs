#!/usr/bin/env node

// ============================================================================
// Tarball contents test for every publishable package
// ============================================================================
//
// publint (each package's `prepack`) checks that the export map is well-formed;
// this script checks what actually ships. It packs every publishable package
// with `pnpm pack` and asserts, per tarball:
//
//   1. Every export/main/module/types/bin target resolves to a file in the
//      tarball. The `selva-source` condition is exempt — it's the monorepo
//      dev-loop condition and deliberately dangles in published packages
//      (its `src/` targets are not shipped).
//   2. No test files (`__tests__/`, `*.test.*`, `*.spec.*`) — tsc compiles
//      tests into dist, so `files` must filter them and this catches when a
//      package forgets.
//   3. No `src/` — unless a resolving (non-`selva-source`) export target
//      points into it (ui ships src/lib for its ./styles/* CSS exports).
//
// Requires built packages: run `pnpm build` first. `pnpm release` runs this
// between build and publish.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { readWorkspacePackages } from './publishable-packages.mjs';

const failures = [];

function pack(dir, dest) {
	const out = execFileSync('pnpm', ['pack', '--pack-destination', dest], {
		cwd: dir,
		encoding: 'utf8',
		shell: process.platform === 'win32'
	});
	// pnpm prints the tarball path as the last line — absolute or relative
	// depending on version, so resolve it against the destination.
	const lines = out.trim().split('\n');
	const last = lines[lines.length - 1].trim();
	return isAbsolute(last) ? last : join(dest, last);
}

function tarballEntries(tarball) {
	// Relative path + cwd: GNU tar reads `C:\...` as a remote host ("Cannot
	// connect to C") when handed a Windows absolute path.
	const out = execFileSync('tar', ['-tzf', basename(tarball)], {
		cwd: dirname(tarball),
		encoding: 'utf8'
	});
	// npm tarballs prefix every entry with `package/`.
	return out
		.trim()
		.split('\n')
		.map((l) => l.replace(/^package\//, ''));
}

// Walk an exports value and yield [conditionPath, target] for every string
// target. A target under `selva-source` anywhere in its condition chain is
// marked exempt.
function* exportTargets(node, chain = []) {
	if (typeof node === 'string') {
		yield { target: node, chain, exempt: chain.includes('selva-source') };
		return;
	}
	if (!node || typeof node !== 'object') return;
	for (const [key, value] of Object.entries(node)) {
		yield* exportTargets(value, [...chain, key]);
	}
}

function targetShipped(target, entries) {
	const rel = target.replace(/^\.\//, '');
	if (!rel.includes('*')) return entries.includes(rel);
	// Wildcard subpath (`./styles/themes/*`): at least one entry must match.
	const [prefix, suffix] = rel.split('*');
	return entries.some((e) => e.startsWith(prefix) && e.endsWith(suffix));
}

function verify(pkg, entries) {
	const manifest = JSON.parse(
		// Relative path + cwd for the same GNU-tar reason as tarballEntries().
		execFileSync('tar', ['-xzOf', basename(pkg.tarball), 'package/package.json'], {
			cwd: dirname(pkg.tarball),
			encoding: 'utf8'
		})
	);
	const problems = [];

	// (1) Every resolving target ships.
	const targets = [];
	if (manifest.exports) targets.push(...exportTargets(manifest.exports));
	for (const field of ['main', 'module', 'types']) {
		if (typeof manifest[field] === 'string')
			targets.push({ target: manifest[field], chain: [field], exempt: false });
	}
	if (manifest.bin) {
		const bins = typeof manifest.bin === 'string' ? { [pkg.name]: manifest.bin } : manifest.bin;
		for (const [name, target] of Object.entries(bins))
			targets.push({ target, chain: ['bin', name], exempt: false });
	}
	let srcAllowed = false;
	for (const { target, chain, exempt } of targets) {
		if (exempt) continue;
		if (target.replace(/^\.\//, '').startsWith('src/')) srcAllowed = true;
		if (!targetShipped(target, entries)) {
			problems.push(`export target missing from tarball: ${chain.join(' > ')} → ${target}`);
		}
	}

	// (2) No test files.
	const testFiles = entries.filter((e) => /(^|\/)__tests__\/|\.test\.|\.spec\./.test(e));
	if (testFiles.length > 0) {
		problems.push(`ships ${testFiles.length} test file(s), e.g. ${testFiles[0]}`);
	}

	// (3) No TypeScript in src/ unless a resolving target points into src/.
	// Plain .js under src/ is runtime code (cli); raw .ts is the dev source the
	// dangling selva-source condition points at and must not ship.
	if (!srcAllowed) {
		const srcFiles = entries.filter((e) => e.startsWith('src/') && /\.(ts|tsx|mts|cts)$/.test(e));
		if (srcFiles.length > 0) {
			problems.push(`ships ${srcFiles.length} src/ .ts file(s), e.g. ${srcFiles[0]} — dangling dev source`);
		}
	}

	return problems;
}

const tmp = mkdtempSync(join(tmpdir(), 'selva-verify-pack-'));
try {
	const packages = readWorkspacePackages()
		.filter((p) => !p.private)
		.sort((a, b) => a.name.localeCompare(b.name));

	for (const pkg of packages) {
		let tarball;
		try {
			tarball = pack(pkg.dir, tmp);
		} catch (err) {
			failures.push(`${pkg.name}: pack failed — ${err.message.split('\n')[0]}`);
			continue;
		}
		const entries = tarballEntries(tarball);
		const problems = verify({ ...pkg, tarball, tmp }, entries);
		if (problems.length > 0) {
			failures.push(`${pkg.name}:\n${problems.map((p) => `    · ${p}`).join('\n')}`);
		} else {
			console.log(`✓ ${pkg.name} (${entries.length} files)`);
		}
	}
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

if (failures.length > 0) {
	console.error('\n✗ verify-pack failed:\n');
	for (const f of failures) console.error('  ' + f);
	console.error('');
	process.exit(1);
}
console.log('✓ all publishable tarballs verified');
