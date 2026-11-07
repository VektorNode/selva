// Guards the schemaVersion bump: if ui-schema.json's definitions changed but the
// schemaVersion default did not, the generators refuse to run. Shared by both
// generate-typescript.js and generate-csharp.js so the two can't drift.

import { execSync } from 'child_process';

// ============================================================================
// Canonicalisation
// ============================================================================

// Whether an object's keys are schema keywords ('keywords'), user-chosen names
// as in `properties`/`definitions` ('names'), or literal data as in `default`/
// `const`/`enum` ('data'). Doc-only content is only stripped at keyword level:
// a property NAMED `description` (LayoutItemBase has one) must survive.
const NAME_MAP_KEYWORDS = new Set(['properties', 'definitions', 'patternProperties']);
const DATA_KEYWORDS = new Set(['default', 'const', 'enum', 'examples']);

function canonicalise(value, mode) {
	if (Array.isArray(value)) {
		return value.map((v) => canonicalise(v, mode));
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	const out = {};
	for (const key of Object.keys(value).sort()) {
		if (mode !== 'data' && key.startsWith('//_')) continue;
		if (mode === 'keywords' && key === 'description') continue;
		let childMode = mode;
		if (mode === 'keywords') {
			childMode = NAME_MAP_KEYWORDS.has(key)
				? 'names'
				: DATA_KEYWORDS.has(key)
					? 'data'
					: 'keywords';
		} else if (mode === 'names') {
			childMode = 'keywords';
		}
		out[key] = canonicalise(value[key], childMode);
	}
	return out;
}

/** Names of the definitions `UISchema` reaches through `$ref`, itself included. */
function reachableFromUISchema(definitions) {
	const seen = new Set(['UISchema']);
	const walk = (node) => {
		if (node === null || typeof node !== 'object') return;
		if (Array.isArray(node)) return node.forEach(walk);
		for (const [key, child] of Object.entries(node)) {
			if (key === '$ref' && typeof child === 'string' && child.startsWith('#/definitions/')) {
				const name = child.slice('#/definitions/'.length);
				if (!seen.has(name)) {
					seen.add(name);
					walk(definitions[name]);
				}
			} else {
				walk(child);
			}
		}
	};
	walk(definitions.UISchema);
	return seen;
}

/**
 * Deterministic string form of the persisted format: the definitions `UISchema`
 * reaches, with doc-only content removed — `//_`-prefixed section comments,
 * `description` keywords (pure documentation; the Guid mapping reads `format`,
 * never the description), and the schemaVersion default (the field being
 * bumped). Two schemas canonicalise equal iff a saved schema reads the same
 * under both.
 *
 * Unreachable definitions don't count: `schemaVersion` versions what is saved
 * into a .gh, and nothing saved can contain a type `UISchema` never reaches.
 *
 * The naive `JSON.stringify(defs, Object.keys(defs).sort())` is NOT a valid
 * implementation: an array replacer filters keys at every nesting level, so
 * every definition serialises as `{}` and property-level edits go undetected.
 */
export function canonicaliseDefinitions(schema) {
	const all = schema.definitions ?? {};
	const reachable = reachableFromUISchema(all);
	const persisted = Object.fromEntries(Object.entries(all).filter(([name]) => reachable.has(name)));
	const defs = canonicalise(persisted, 'names');
	if (defs.UISchema?.properties?.schemaVersion) {
		delete defs.UISchema.properties.schemaVersion.default;
	}
	// canonicalise already sorted keys recursively, so plain stringify is stable.
	return JSON.stringify(defs);
}

export function schemaVersionOf(schema) {
	return schema.definitions?.UISchema?.properties?.schemaVersion?.default ?? '0.0.0';
}

// ============================================================================
// Guard
// ============================================================================

// The same pattern ui-schema.json puts on schemaVersion: no prerelease or build suffix.
const SCHEMA_VERSION = /^\d+\.\d+\.\d+$/;

/** Negative, zero or positive as `a` is below, equal to or above `b`. */
function compareVersions(a, b) {
	for (const version of [a, b]) {
		if (!SCHEMA_VERSION.test(version)) {
			throw new Error(`schemaVersion "${version}" is not MAJOR.MINOR.PATCH.`);
		}
	}
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		const d = pa[i] - pb[i];
		if (d !== 0) return d;
	}
	return 0;
}

/**
 * Pure comparison: did the definitions change, and which way did the version move?
 * Split from the git plumbing so it is unit-testable.
 */
export function compareSchemas(baseSchema, workingSchema) {
	const direction = compareVersions(schemaVersionOf(workingSchema), schemaVersionOf(baseSchema));
	return {
		definitionsChanged:
			canonicaliseDefinitions(baseSchema) !== canonicaliseDefinitions(workingSchema),
		versionBumped: direction > 0,
		versionDowngraded: direction < 0
	};
}

/**
 * Why the working schema may not be generated from, or null. A downgrade always fails: .gh files
 * already saved at the higher version would claim a format the plugin no longer writes.
 */
export function schemaGuardError(baseSchema, workingSchema, baseRef) {
	const working = schemaVersionOf(workingSchema);
	if (!SCHEMA_VERSION.test(working)) {
		return `schemaVersion must be MAJOR.MINOR.PATCH, with no prerelease or build suffix: got ${working}.`;
	}
	const { definitionsChanged, versionBumped, versionDowngraded } = compareSchemas(
		baseSchema,
		workingSchema
	);
	const from = schemaVersionOf(baseSchema);
	const to = schemaVersionOf(workingSchema);
	if (versionDowngraded) {
		return [
			`schemaVersion went backwards (vs ${baseRef}): ${from} -> ${to}.`,
			'Restore it to at least the base version; bump it if the definitions changed.'
		].join('\n  ');
	}
	if (definitionsChanged && !versionBumped) {
		return [
			`Schema definitions changed (vs ${baseRef}) but schemaVersion was not bumped.`,
			`Current version: ${to}`,
			'',
			'Update the "schemaVersion" default in UISchema (e.g. 2.13.0 -> 2.14.0),',
			'add a migration entry in SchemaMigrator.cs, and add a changeset.'
		].join('\n  ');
	}
	return null;
}

/**
 * Exits the process when the working schema fails {@link schemaGuardError} against the base ref.
 * The base ref defaults to HEAD (catches uncommitted local edits); CI sets SCHEMA_GUARD_BASE_REF
 * to the PR base branch, since in CI the working tree always matches HEAD and a HEAD comparison
 * can never fire.
 */
export function checkSchemaVersionBumped({ workingSchema, repoRoot, schemaRepoPath }) {
	const baseRef = process.env.SCHEMA_GUARD_BASE_REF || 'HEAD';

	let baseSchemaStr;
	try {
		baseSchemaStr = execSync(`git show ${baseRef}:${schemaRepoPath}`, {
			cwd: repoRoot,
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'pipe']
		});
	} catch {
		// Not a git repo, no commits yet, or the base ref is unavailable — skip.
		return;
	}

	const baseSchema = JSON.parse(baseSchemaStr);
	const error = schemaGuardError(baseSchema, workingSchema, baseRef);
	if (error) {
		console.error(`\n  ERROR: ${error}\n`);
		process.exit(1);
	}

	if (compareSchemas(baseSchema, workingSchema).definitionsChanged) {
		console.info(
			`  Schema version bumped: ${schemaVersionOf(baseSchema)} -> ${schemaVersionOf(workingSchema)}`
		);
	}
}
