import { describe, expect, it } from 'vitest';
import { canonicaliseDefinitions, compareSchemas, schemaVersionOf } from './version-guard.js';

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
					name: { type: 'string', description: 'Display name' }
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
		expect(compareSchemas(makeSchema(), changed).definitionsChanged).toBe(true);

		const removed = makeSchema();
		delete removed.definitions.Widget;
		expect(compareSchemas(makeSchema(), removed).definitionsChanged).toBe(true);
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

describe('schemaVersionOf', () => {
	it('reads the schemaVersion default', () => {
		expect(schemaVersionOf(makeSchema())).toBe('2.14.0');
	});

	it('falls back to 0.0.0 when absent', () => {
		expect(schemaVersionOf({ definitions: {} })).toBe('0.0.0');
	});
});
