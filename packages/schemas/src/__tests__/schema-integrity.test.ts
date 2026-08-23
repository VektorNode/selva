// Invariants of the schema source files themselves. Everything here fails
// silently in production if broken: duplicate JSON keys vanish on parse, a
// dangling $ref generates `object`/`unknown` types, and a LayoutItem variant
// without its discriminators can't be deserialized by the C# converter.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { UI_SCHEMA_VERSION } from '../index.js';

const uiSchemaUrl = new URL('../../ui-schema.json', import.meta.url);
const presetSchemaUrl = new URL('../../preset-schema.json', import.meta.url);

const rawUiSchema = readFileSync(uiSchemaUrl, 'utf8');
const uiSchema = JSON.parse(rawUiSchema) as {
	definitions: Record<string, SchemaDef>;
};
const presetSchema = JSON.parse(readFileSync(presetSchemaUrl, 'utf8')) as {
	definitions: Record<string, SchemaDef>;
};

interface SchemaDef {
	type?: string;
	const?: string;
	enum?: unknown[];
	format?: string;
	properties?: Record<string, SchemaDef>;
	allOf?: SchemaDef[];
	oneOf?: SchemaDef[];
	$ref?: string;
	[key: string]: unknown;
}

function collectRefs(value: unknown, refs: string[] = []): string[] {
	if (Array.isArray(value)) {
		for (const v of value) collectRefs(v, refs);
	} else if (value !== null && typeof value === 'object') {
		for (const [key, child] of Object.entries(value)) {
			if (key === '$ref' && typeof child === 'string') refs.push(child);
			else collectRefs(child, refs);
		}
	}
	return refs;
}

/** Resolve a property's `const` through a variant's allOf parts. */
function constOf(def: SchemaDef, propName: string): string | undefined {
	if (def.properties?.[propName]?.const !== undefined) return def.properties[propName].const;
	for (const part of def.allOf ?? []) {
		if (part.properties?.[propName]?.const !== undefined) return part.properties[propName].const;
	}
	return undefined;
}

describe('ui-schema.json', () => {
	it('has no duplicate section-comment keys (duplicates vanish on JSON.parse)', () => {
		const keys = [...rawUiSchema.matchAll(/"(\/\/_[A-Za-z0-9_]+)"\s*:/g)].map((m) => m[1]);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it('every $ref resolves to a definition', () => {
		for (const ref of collectRefs(uiSchema)) {
			const name = ref.replace('#/definitions/', '');
			expect(uiSchema.definitions[name], `dangling $ref: ${ref}`).toBeDefined();
		}
	});

	it('every LayoutItem variant declares its discriminators', () => {
		const refs = uiSchema.definitions.LayoutItem.oneOf ?? [];
		expect(refs.length).toBeGreaterThan(0);
		for (const ref of refs) {
			const name = (ref.$ref ?? '').replace('#/definitions/', '');
			const def = uiSchema.definitions[name];
			const type = constOf(def, 'type');
			expect(type, `${name} needs a 'type' const`).toBeDefined();
			if (type === 'input' || type === 'output') {
				expect(constOf(def, 'widgetType'), `${name} needs a 'widgetType' const`).toBeDefined();
			}
		}
	});

	it('guid-formatted properties are strings', () => {
		function walk(def: SchemaDef, path: string) {
			if (def.format === 'guid') {
				expect(def.type, `${path} has format: guid but type ${def.type}`).toBe('string');
			}
			for (const [name, child] of Object.entries(def.properties ?? {})) {
				walk(child, `${path}.${name}`);
			}
			for (const part of def.allOf ?? []) walk(part, path);
		}
		for (const [name, def] of Object.entries(uiSchema.definitions)) {
			if (typeof def === 'object') walk(def, name);
		}
	});

	it('schemaVersion default matches the generated UI_SCHEMA_VERSION (run pnpm generate)', () => {
		const defaultVersion = uiSchema.definitions.UISchema.properties?.schemaVersion?.default;
		expect(defaultVersion).toBe(UI_SCHEMA_VERSION);
	});
});

describe('preset-schema.json', () => {
	it('every $ref resolves to a definition', () => {
		for (const ref of collectRefs(presetSchema)) {
			const name = ref.replace('#/definitions/', '');
			expect(presetSchema.definitions[name], `dangling $ref: ${ref}`).toBeDefined();
		}
	});
});
