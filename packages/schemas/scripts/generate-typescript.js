#!/usr/bin/env node

import { compile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import prettier from 'prettier';
import { checkSchemaVersionBumped } from './lib/version-guard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..');
const repoRoot = path.join(packageRoot, '..', '..');

/** Deep copy with the `//_`-prefixed section-comment keys removed. */
function stripCommentKeys(value) {
	if (Array.isArray(value)) return value.map(stripCommentKeys);
	if (value === null || typeof value !== 'object') return value;
	const out = {};
	for (const [key, child] of Object.entries(value)) {
		if (key.startsWith('//_')) continue;
		out[key] = stripCommentKeys(child);
	}
	return out;
}

async function generateSchema(schemaFileName, outputFileName, rootTypeName, options = {}) {
	const schemaPath = path.join(packageRoot, schemaFileName);
	const outputPath = path.join(packageRoot, `./src/generated/${outputFileName}`);

	const schema = stripCommentKeys(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));

	// The root $ref confuses json-schema-to-typescript; the definitions carry everything.
	delete schema.$ref;

	try {
		const ts = await compile(schema, rootTypeName, {
			bannerComment: `/* eslint-disable */\n/**\n * This file was automatically generated from packages/schemas/${schemaFileName}.\n * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file\n * and run \`pnpm generate\` at the repo root to regenerate it.\n */\n`,
			style: {
				singleQuote: true
			},
			unreachableDefinitions: true,
			strictIndexSignatures: true
		});

		// Strip the "This interface was referenced by ..." comment blocks the
		// compiler emits for unreachable definitions — noise in the output.
		let output = ts;
		const lines = output.split('\n');
		const filtered = [];
		let inReferenceComment = false;
		let commentStartIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.includes('This interface was referenced by')) {
				inReferenceComment = true;
				for (let j = filtered.length - 1; j >= 0; j--) {
					if (filtered[j].trim() === '/**') {
						commentStartIndex = j;
						break;
					}
					if (filtered[j].trim() === '*/') {
						commentStartIndex = filtered.length;
						break;
					}
				}
				continue;
			}
			if (inReferenceComment) {
				if (line.trim() === '*/') {
					if (commentStartIndex >= 0 && commentStartIndex < filtered.length) {
						filtered.splice(commentStartIndex);
					}
					inReferenceComment = false;
					commentStartIndex = -1;
				}
				continue;
			}
			filtered.push(line);
		}

		output = filtered.join('\n');

		if (options.appendCode) {
			output += options.appendCode;
		}

		const outputDir = path.dirname(outputPath);
		if (!fs.existsSync(outputDir)) {
			fs.mkdirSync(outputDir, { recursive: true });
		}

		const prettierConfig = await prettier.resolveConfig(outputPath);
		output = await prettier.format(output, { ...prettierConfig, filepath: outputPath });

		fs.writeFileSync(outputPath, output);
		console.info(`Generated TypeScript types at: ${outputPath}`);
	} catch (error) {
		console.error(`Error generating TypeScript for ${schemaFileName}:`, error);
		process.exit(1);
	}
}

// ============================================================================
// LAYOUT ITEM GUARDS — derived from the LayoutItem union
// ============================================================================

function pascalCase(str) {
	return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Resolve a property's `const` through the variant's allOf parts. */
function constOf(def, propName) {
	if (def.properties?.[propName]?.const !== undefined) {
		return def.properties[propName].const;
	}
	for (const part of def.allOf ?? []) {
		if (part.properties?.[propName]?.const !== undefined) {
			return part.properties[propName].const;
		}
	}
	return undefined;
}

/**
 * Type aliases and guards for every LayoutItem variant, derived from the
 * union in the schema. A new variant gets its alias membership and guard for
 * free — nothing here to keep in sync by hand. Naming: input variants get
 * `is<Widget>Widget`, output variants `is<Widget>OutputWidget`.
 */
function buildLayoutItemHelpers(schema) {
	const defs = schema.definitions;
	const refs = defs.LayoutItem?.oneOf ?? [];
	const variants = refs.map((r) => {
		const name = r.$ref.replace('#/definitions/', '');
		const def = defs[name];
		if (!def) {
			console.error(`LayoutItem union references missing definition: ${name}`);
			process.exit(1);
		}
		const type = constOf(def, 'type');
		if (!type) {
			console.error(`LayoutItem variant ${name} has no 'type' const discriminator`);
			process.exit(1);
		}
		return { name, type, widgetType: constOf(def, 'widgetType') };
	});

	const inputs = variants.filter((v) => v.type === 'input');
	const outputs = variants.filter((v) => v.type === 'output');

	let code = `
// ============================================================================
// TYPE ALIASES AND GUARDS (derived from the LayoutItem union)
// ============================================================================

export type InputLayoutItem = ${inputs.map((v) => v.name).join(' | ')};
export type OutputLayoutItem = ${outputs.map((v) => v.name).join(' | ')};
export type SupportedTypes = string | number | boolean | string[];

export function isInputLayoutItem(item: LayoutItem): item is InputLayoutItem {
	return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputLayoutItem {
	return item.type === 'output';
}

export function isLineBreakLayoutItem(item: LayoutItem): item is LineBreakLayoutItem {
	return item.type === 'linebreak';
}
`;

	for (const v of inputs) {
		code += `
export function is${pascalCase(v.widgetType)}Widget(item: LayoutItem): item is ${v.name} {
	return item.type === 'input' && item.widgetType === '${v.widgetType}';
}
`;
	}
	for (const v of outputs) {
		code += `
export function is${pascalCase(v.widgetType)}OutputWidget(item: LayoutItem): item is ${v.name} {
	return item.type === 'output' && item.widgetType === '${v.widgetType}';
}
`;
	}

	return code;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
	const schemaPath = path.join(packageRoot, 'ui-schema.json');
	const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

	checkSchemaVersionBumped({
		workingSchema: schema,
		repoRoot,
		schemaRepoPath: 'packages/schemas/ui-schema.json'
	});

	let constantsCode = '';
	if (schema.constants) {
		constantsCode = `
// ============================================================================
// CONSTANTS (from schema)
// ============================================================================

`;
		for (const [key, value] of Object.entries(schema.constants)) {
			const constName = key.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
			constantsCode += `export const ${constName} = ${JSON.stringify(value, null, 2)} as const;\n`;
		}
	}

	// Current schema-format version — single source of truth is the
	// schemaVersion default in ui-schema.json (mirrors C# SchemaVersion.CURRENT).
	const currentSchemaVersion = schema.definitions?.UISchema?.properties?.schemaVersion?.default;
	if (!currentSchemaVersion) {
		console.error('ui-schema.json is missing UISchema.properties.schemaVersion.default');
		process.exit(1);
	}
	constantsCode += `
/** Current UISchema format version (from ui-schema.json's schemaVersion default). */
export const UI_SCHEMA_VERSION = ${JSON.stringify(currentSchemaVersion)};
`;

	await generateSchema('ui-schema.json', 'schema.ts', 'UISchemaRoot', {
		appendCode: `${constantsCode}${buildLayoutItemHelpers(schema)}`
	});

	await generateSchema('preset-schema.json', 'preset.ts', 'ParameterPresetRoot');
}

main();
