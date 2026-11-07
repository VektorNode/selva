import { describe, expect, it } from 'vitest';
import {
	canonicaliseDefinitions,
	compareSchemas,
	schemaGuardError,
	schemaVersionOf
} from './version-guard.js';

// The guard's whole job is detecting definition edits that lack a version bump.
// The original implementation used JSON.stringify's array-replacer form, which
// filters keys at every nesting level — every definition serialised as `{}` and
// property-level edits passed silently. These tests pin the repaired contract.

function makeSchema() {
	return {
		definitions: {
			'//_SECTION': '--- section comment ---',
			UISchema: {
				type: 'object',
				properties: {
					schemaVersion: { type: 'string', default: '2.14.0' },
					name: { type: 'string', description: 'Display name' },
					widget: { $ref: '#/definitions/Widget' }
				},
				required: ['name']
			},
			Widget: {
				type: 'object',
				properties: {
					description: { type: 'string' },
					size: { type: 'number', enum: [1, 2, 3] }
				}
			}
		}
	};
}

describe('compareSchemas — detects real definition changes', () => {
	it('detects a property added inside an existing definition', () => {
		const changed = makeSchema();
		changed.definitions.Widget.properties.color = { type: 'string' };
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);
	});

	it('detects a type change on a nested property', () => {
		const changed = makeSchema();
		changed.definitions.Widget.properties.size.type = 'string';
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);
	});

	it('detects an enum value change', () => {
		const changed = makeSchema();
		changed.definitions.Widget.properties.size.enum.push(4);
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);
	});

	it('detects a required-list change', () => {
		const changed = makeSchema();
		changed.definitions.UISchema.required = [];
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);
	});

	it('detects a definition added or removed', () => {
		const changed = makeSchema();
		changed.definitions.NewThing = { type: 'object' };
		changed.definitions.UISchema.properties.thing = { $ref: '#/definitions/NewThing' };
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);

		const removed = makeSchema();
		delete removed.definitions.Widget;
		expect(compareSchemas(makeSchema(), removed).definitionsChanged).toBe(true);
	});

	it('ignores a definition UISchema cannot reach', () => {
		const changed = makeSchema();
		changed.definitions.WireOnly = { type: 'object', properties: { seq: { type: 'integer' } } };
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(false);
	});

	it('detects removal of a property that is literally named "description"', () => {
		const changed = makeSchema();
		delete changed.definitions.Widget.properties.description;
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);
	});
});

describe('compareSchemas — ignores doc-only changes', () => {
	it('ignores description keyword edits', () => {
		const changed = makeSchema();
		changed.definitions.UISchema.properties.name.description = 'Renamed for clarity';
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(false);
	});

	it('ignores section-comment key renames and additions', () => {
		const changed = makeSchema();
		delete changed.definitions['//_SECTION'];
		changed.definitions['//_RENAMED'] = 'something else';
		changed.definitions['//_EXTRA'] = 'another comment';
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(false);
	});

	it('ignores the schemaVersion default (the field being bumped)', () => {
		const changed = makeSchema();
		changed.definitions.UISchema.properties.schemaVersion.default = '2.15.0';
		const result = compareSchemas(makeSchema(), changed);
		expect(result.definitionsChanged).toBe(false);
		expect(result.versionBumped).toBe(true);
	});

	it('is insensitive to key order', () => {
		const reordered = {
			definitions: {
				Widget: makeSchema().definitions.Widget,
				UISchema: makeSchema().definitions.UISchema,
				'//_SECTION': '--- section comment ---'
			}
		};
		expect(canonicaliseDefinitions(reordered)).toBe(canonicaliseDefinitions(makeSchema()));
	});
});

describe('compareSchemas — version direction', () => {
	const withVersion = (version) => {
		const schema = makeSchema();
		schema.definitions.UISchema.properties.schemaVersion.default = version;
		return schema;
	};

	it('compares versions numerically, not as strings', () => {
		expect(compareSchemas(withVersion('2.9.0'), withVersion('2.10.0'))).toMatchObject({
			versionBumped: true,
			versionDowngraded: false
		});
	});

	it('treats a lower version as a downgrade, never a bump', () => {
		expect(compareSchemas(withVersion('2.14.0'), withVersion('2.13.0'))).toMatchObject({
			versionBumped: false,
			versionDowngraded: true
		});
	});

	// A NaN direction would read as neither a bump nor a downgrade.
	it.each(['2.20.0-beta.1', '2.20', 'v2.20.0'])('throws on %s rather than comparing it', (bad) => {
		expect(() => compareSchemas(withVersion('2.19.0'), withVersion(bad))).toThrow(
			/MAJOR\.MINOR\.PATCH/
		);
	});
});

describe('schemaGuardError', () => {
	it('rejects a downgrade even when the definitions changed with it', () => {
		const changed = makeSchema();
		changed.definitions.UISchema.properties.schemaVersion.default = '2.13.0';
		changed.definitions.Widget.properties.color = { type: 'string' };
		expect(schemaGuardError(makeSchema(), changed, 'HEAD')).toMatch(/2\.14\.0 -> 2\.13\.0/);
	});

	it('rejects changed definitions without a bump', () => {
		const changed = makeSchema();
		changed.definitions.Widget.properties.color = { type: 'string' };
		expect(schemaGuardError(makeSchema(), changed, 'HEAD')).toMatch(/not bumped/);
	});

	it('rejects a working version with a prerelease suffix, bump or not', () => {
		const prerelease = makeSchema();
		prerelease.definitions.UISchema.properties.schemaVersion.default = '2.15.0-beta.1';
		prerelease.definitions.Widget.properties.color = { type: 'string' };
		expect(schemaGuardError(makeSchema(), prerelease, 'HEAD')).toMatch(/2\.15\.0-beta\.1/);
	});

	it('accepts changed definitions with a bump, and an unchanged schema', () => {
		const changed = makeSchema();
		changed.definitions.UISchema.properties.schemaVersion.default = '2.15.0';
		changed.definitions.Widget.properties.color = { type: 'string' };
		expect(schemaGuardError(makeSchema(), changed, 'HEAD')).toBeNull();
		expect(schemaGuardError(makeSchema(), makeSchema(), 'HEAD')).toBeNull();
	});
});

describe('schemaVersionOf', () => {
	it('reads the schemaVersion default', () => {
		expect(schemaVersionOf(makeSchema())).toBe('2.14.0');
	});

	it('falls back to 0.0.0 when absent', () => {
		expect(schemaVersionOf({ definitions: {} })).toBe('0.0.0');
	});
});
