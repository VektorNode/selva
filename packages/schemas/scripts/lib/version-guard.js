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
			childMode = NAME_MAP_KEYWORDS.has(key) ? 'names' : DATA_KEYWORDS.has(key) ? 'data' : 'keywords';
		} else if (mode === 'names') {
			childMode = 'keywords';
		}
		out[key] = canonicalise(value[key], childMode);
	}
	return out;
}

/**
 * Deterministic string form of a schema's definitions with doc-only content
 * removed — `//_`-prefixed section comments, `description` keywords (pure
 * documentation; the Guid mapping reads `format`, never the description), and
 * the schemaVersion default (the field being bumped). Two schemas canonicalise
 * equal iff they describe the same format.
 *
 * The naive `JSON.stringify(defs, Object.keys(defs).sort())` is NOT a valid
 * implementation: an array replacer filters keys at every nesting level, so
 * every definition serialises as `{}` and property-level edits go undetected.
 */
export function canonicaliseDefinitions(schema) {
	const defs = canonicalise(schema.definitions ?? {}, 'names');
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

/**
 * Pure comparison: did the definitions change, and was the version bumped?
 * Split from the git plumbing so it is unit-testable.
 */
export function compareSchemas(baseSchema, workingSchema) {
	return {
		definitionsChanged:
			canonicaliseDefinitions(baseSchema) !== canonicaliseDefinitions(workingSchema),
		versionBumped: schemaVersionOf(baseSchema) !== schemaVersionOf(workingSchema)
	};
}

/**
 * Exits the process when definitions changed against the base ref without a
 * schemaVersion bump. The base ref defaults to HEAD (catches uncommitted local
 * edits); CI sets SCHEMA_GUARD_BASE_REF to the PR base branch, since in CI the
 * working tree always matches HEAD and a HEAD comparison can never fire.
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
	const { definitionsChanged, versionBumped } = compareSchemas(baseSchema, workingSchema);

	if (definitionsChanged && !versionBumped) {
		const version = schemaVersionOf(workingSchema);
		console.error('');
		console.error(
			`  ERROR: Schema definitions changed (vs ${baseRef}) but schemaVersion was not bumped.`
		);
		console.error(`  Current version: ${version}`);
		console.error('');
		console.error('  Update the "schemaVersion" default in UISchema (e.g. 2.13.0 -> 2.14.0),');
		console.error('  add a migration entry in SchemaMigrator.cs, and add a changeset.');
		console.error('');
		process.exit(1);
	}

	if (definitionsChanged) {
		console.info(
			`  Schema version bumped: ${schemaVersionOf(baseSchema)} -> ${schemaVersionOf(workingSchema)}`
		);
	}
}
