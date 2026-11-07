#!/usr/bin/env node

// ============================================================================
// Released-component wire-compatibility guard
// ============================================================================
//
// Grasshopper binds wires by parameter index. Changing a released component's
// param list while keeping its ComponentGuid silently rewires saved
// definitions — nothing fails at build time. The required procedure (snapshot
// into OBSOLETE/, new GUID, IGH_UpgradeObject) lives in STRUCTURE.md; this
// script makes forgetting it a CI failure instead of a user's corrupted file.
//
//   --check   Compare components against Plugin/Selva.GH/component-signatures.json
//   --update  Rewrite the snapshot (bless new components and cosmetic moves)
//   --root    Repo root to read, for tests (default: this repo)
//
// Source-level on purpose: the test suite cannot load Grasshopper/RhinoCommon
// headless, so signatures are parsed from the C# source. One component class
// per file (verified across the tree).
//
// Components under OBSOLETE/ are checked too: they are what saved files holding
// an old GUID load into before the upgrader runs, so their params never change.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

function usage() {
	console.error('Usage: check-component-signatures.mjs --check | --update [--root <dir>]');
	process.exit(1);
}

let options;
try {
	options = parseArgs({
		options: { check: { type: 'boolean' }, update: { type: 'boolean' }, root: { type: 'string' } }
	}).values;
} catch {
	usage();
}
if (Boolean(options.check) === Boolean(options.update)) usage();

const repoRoot = options.root
	? resolve(options.root)
	: join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const featuresRoot = join(repoRoot, 'Plugin/Selva.GH/Features');
const snapshotPath = join(repoRoot, 'Plugin/Selva.GH/component-signatures.json');

// ============================================================================
// C# source parsing
// ============================================================================

function* walkCsFiles(dir) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'obj' || entry.name === 'bin') continue;
			yield* walkCsFiles(full);
		} else if (entry.name.endsWith('.cs')) {
			yield full;
		}
	}
}

/** Slice the balanced-paren argument text starting at an opening '('. */
function sliceParens(source, openIndex) {
	let depth = 0;
	let inString = false;
	for (let i = openIndex; i < source.length; i++) {
		const ch = source[i];
		if (inString) {
			if (ch === '\\') i++;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === '(') depth++;
		else if (ch === ')') {
			depth--;
			if (depth === 0) return source.slice(openIndex + 1, i);
		}
	}
	return null;
}

/** Slice a method's balanced-brace body starting after its signature. */
function sliceBody(source, methodName) {
	const sig = source.indexOf(methodName);
	if (sig === -1) return null;
	const open = source.indexOf('{', sig);
	if (open === -1) return null;
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		const ch = source[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return source.slice(open + 1, i);
		}
	}
	return null;
}

/** Ordered param registrations in a Register*Params body. */
function parseParams(body) {
	if (!body) return [];
	const params = [];
	const callRe = /pManager\.(Add\w*Parameter)\s*\(/g;
	let m;
	while ((m = callRe.exec(body)) !== null) {
		const args = sliceParens(body, callRe.lastIndex - 1) ?? '';
		// AddParameter(new Param_X(...)) registers a custom param type; the
		// typed helpers (AddTextParameter, ...) carry the kind in the name.
		const custom = args.match(/^\s*new\s+(\w+)/);
		const kind = custom ? `AddParameter:${custom[1]}` : m[1];
		const name = args.match(/"((?:[^"\\]|\\.)*)"/)?.[1] ?? null;
		const access = args.match(/GH_ParamAccess\.(\w+)/)?.[1] ?? null;
		params.push({ kind, name, access });
	}
	return params;
}

function readComponents() {
	const components = [];
	for (const file of walkCsFiles(featuresRoot)) {
		const source = readFileSync(file, 'utf8');
		const guidMatch = source.match(
			/ComponentGuid[\s\S]{0,200}?new\s+Guid\s*\(\s*"([0-9A-Fa-f-]{36})"/
		);
		if (!guidMatch) continue;
		// The first class with a base list: a solve-result helper declared above the component has none.
		const className =
			(source.match(/^[\t ]*(?:\w+\s+)*class\s+(\w+)(?:<[^>]*>)?\s*:/m) ??
				source.match(/\bclass\s+(\w+)/))?.[1] ?? '(unknown)';
		components.push({
			guid: guidMatch[1].toUpperCase(),
			class: className,
			file: relative(repoRoot, file).replace(/\\/g, '/'),
			inputs: parseParams(sliceBody(source, 'RegisterInputParams')),
			outputs: parseParams(sliceBody(source, 'RegisterOutputParams'))
		});
	}
	return components.sort((a, b) => a.guid.localeCompare(b.guid));
}

// ============================================================================
// Comparison
// ============================================================================

/**
 * The wire-breaking part of a signature: every param's kind, access and name, in order. Names
 * count: swapping two same-type params (Width, Height) keeps every kind in place, yet each wire
 * now feeds the other input, and in source a swap looks the same as two renames.
 */
function structural(component) {
	return JSON.stringify({ inputs: component.inputs, outputs: component.outputs });
}

const isObsolete = (component) => component.file.includes('/OBSOLETE/');

function check(components) {
	let snapshot;
	try {
		snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
	} catch {
		console.error(`✗ Missing or unreadable snapshot: ${relative(repoRoot, snapshotPath)}`);
		console.error('  Run: node scripts/plugin/check-component-signatures.mjs --update');
		process.exit(1);
	}

	const live = new Map(components.map((c) => [c.guid, c]));
	const known = new Map(snapshot.components.map((c) => [c.guid, c]));
	const errors = [];

	for (const [guid, was] of known) {
		const now = live.get(guid);
		if (!now && isObsolete(was)) {
			errors.push(
				`OBSOLETE component removed: ${was.class} (${guid}, ${was.file}).\n` +
					`  Saved definitions holding this GUID load into it before upgrading. Restore it.`
			);
			continue;
		}
		if (!now) {
			errors.push(
				`Component removed: ${was.class} (${guid}).\n` +
					`  If it was ever released, keep a snapshot in OBSOLETE/ with an IGH_UpgradeObject\n` +
					`  (see STRUCTURE.md), then bless the removal with --update.`
			);
			continue;
		}
		const paramsChanged = structural(now) !== structural(was);
		if (paramsChanged && isObsolete(was)) {
			errors.push(
				`OBSOLETE component changed: ${now.class} (${guid}, ${now.file}).\n` +
					`  Saved definitions holding this GUID load into these params by index before\n` +
					`  upgrading. Restore them as they were.`
			);
		} else if (paramsChanged) {
			errors.push(
				`Param list changed on released GUID ${guid} (${now.class}, ${now.file}).\n` +
					`  Grasshopper binds wires by index — a reordered, renamed, added or removed param\n` +
					`  silently rewires saved definitions.\n` +
					`  Follow the OBSOLETE + upgrader procedure in STRUCTURE.md: snapshot the old\n` +
					`  component, give the live one a NEW GUID, add an IGH_UpgradeObject, then --update.`
			);
		} else if (JSON.stringify(now) !== JSON.stringify(was)) {
			errors.push(
				`Cosmetic signature change for ${now.class} (${guid}) — class renamed or file moved.\n` +
					`  Not wire-breaking. Bless it with: node scripts/plugin/check-component-signatures.mjs --update`
			);
		}
	}
	for (const [guid, now] of live) {
		if (!known.has(guid)) {
			errors.push(
				`New component: ${now.class} (${guid}).\n` +
					`  Record it with: node scripts/plugin/check-component-signatures.mjs --update`
			);
		}
	}

	if (errors.length > 0) {
		console.error('✗ Component-signature check failed:\n');
		for (const e of errors) console.error(`  ${e}\n`);
		process.exit(1);
	}
	console.info(`✓ ${components.length} component signatures match the snapshot`);
}

function update(components) {
	const snapshot = {
		'//': 'Generated by scripts/plugin/check-component-signatures.mjs --update. Do not edit by hand.',
		components
	};
	writeFileSync(snapshotPath, JSON.stringify(snapshot, null, '\t') + '\n');
	console.info(
		`✓ Snapshot updated: ${relative(repoRoot, snapshotPath)} (${components.length} components)`
	);
}

// ============================================================================
// CLI
// ============================================================================

const components = readComponents();
const byGuid = new Map();
for (const c of components) {
	const other = byGuid.get(c.guid);
	if (other) {
		console.error(
			`✗ Duplicate ComponentGuid ${c.guid}: ${other.file} and ${c.file} share an identity.\n` +
				`  A component moved to OBSOLETE/ keeps its GUID; the live one needs a new one.`
		);
		process.exit(1);
	}
	byGuid.set(c.guid, c);
}

if (options.update) update(components);
else check(components);
