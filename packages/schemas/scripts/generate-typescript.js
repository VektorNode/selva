#!/usr/bin/env node

import { compile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import prettier from 'prettier';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..');

async function generateSchema(schemaFileName, outputFileName, rootTypeName, options = {}) {
  const schemaPath = path.join(packageRoot, schemaFileName);
  const outputPath = path.join(packageRoot, `./src/generated/${outputFileName}`);

  if (!fs.existsSync(schemaPath)) {
    console.warn(`Schema file not found: ${schemaPath}`);
    return;
  }

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  // Remove the root $ref that causes issues
  delete schema.$ref;

  try {
    const ts = await compile(schema, rootTypeName, {
      bannerComment: `/* eslint-disable */\n/**\n * This file was automatically generated from schemas/${schemaFileName}.\n * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,\n * and run \`npm run generate:ts\` in the schemas directory to regenerate this file.\n */\n`,
      style: {
        singleQuote: true,
      },
      unreachableDefinitions: true,
      strictIndexSignatures: true,
    });

    // Post-process to remove "referenced by" comments
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

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const prettierConfig = await prettier.resolveConfig(outputPath);
    output = await prettier.format(output, { ...prettierConfig, filepath: outputPath });

    fs.writeFileSync(outputPath, output);
    console.log(`Generated TypeScript types at: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating TypeScript for ${schemaFileName}:`, error);
    process.exit(1);
  }
}

async function main() {
  // Read schema to extract constants
  const schemaPath = path.join(packageRoot, 'ui-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  // Generate constants code
  let constantsCode = '';
  if (schema.constants) {
    constantsCode = `
// ============================================================================
// CONSTANTS (from schema)
// ============================================================================

`;
    for (const [key, value] of Object.entries(schema.constants)) {
      // Convert camelCase to SCREAMING_SNAKE_CASE
      const constName = key
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toUpperCase();
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

  // Generate UI Schema types
  await generateSchema('ui-schema.json', 'schema.ts', 'UISchemaRoot', {
    appendCode: `
${constantsCode}
// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputDynamicValueListLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem | InputColorLayoutItem {
  return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem | OutputChartLayoutItem | OutputImageLayoutItem | OutputDynamicValueListLayoutItem {
  return item.type === 'output';
}

export function isLineBreakLayoutItem(item: LayoutItem): item is LineBreakLayoutItem {
  return item.type === 'linebreak';
}

export function isNumberWidget(item: LayoutItem): item is InputNumberLayoutItem {
  return item.type === 'input' && item.widgetType === 'number';
}

export function isTextWidget(item: LayoutItem): item is InputTextLayoutItem {
  return item.type === 'input' && item.widgetType === 'text';
}

export function isDropdownWidget(item: LayoutItem): item is InputDropdownLayoutItem {
  return item.type === 'input' && item.widgetType === 'dropdown';
}

export function isDynamicValueListWidget(item: LayoutItem): item is InputDynamicValueListLayoutItem {
  return item.type === 'input' && item.widgetType === 'dynamicValueList';
}

export function isCheckboxWidget(item: LayoutItem): item is InputCheckboxLayoutItem {
  return item.type === 'input' && item.widgetType === 'checkbox';
}

export function isFileWidget(item: LayoutItem): item is InputFileLayoutItem {
  return item.type === 'input' && item.widgetType === 'file';
}

export function isColorWidget(item: LayoutItem): item is InputColorLayoutItem {
  return item.type === 'input' && item.widgetType === 'color';
}

export function isImageWidget(item: LayoutItem): item is OutputImageLayoutItem {
  return item.type === 'output' && item.widgetType === 'image';
}

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputDynamicValueListLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem | InputColorLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem | OutputChartLayoutItem | OutputImageLayoutItem | OutputDynamicValueListLayoutItem;
export type SupportedTypes = string | number | boolean | string[];
`,
  });

  // Generate Preset Schema types
  await generateSchema('preset-schema.json', 'preset.ts', 'ParameterPresetRoot');
}

checkSchemaVersionBumped();
main();

function checkSchemaVersionBumped() {
  const schemaPath = path.join(packageRoot, 'ui-schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  function canonicalise(schemaObj) {
    const defs = { ...schemaObj.definitions };
    for (const key of Object.keys(defs)) {
      if (key.startsWith('//_')) delete defs[key];
    }
    if (defs.UISchema?.properties?.schemaVersion) {
      defs.UISchema = JSON.parse(JSON.stringify(defs.UISchema));
      delete defs.UISchema.properties.schemaVersion.default;
    }
    return JSON.stringify(defs, Object.keys(defs).sort());
  }

  let committedSchemaStr;
  try {
    committedSchemaStr = execSync('git show HEAD:packages/schemas/ui-schema.json', {
      cwd: path.join(packageRoot, '..', '..'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return;
  }

  const committedSchema = JSON.parse(committedSchemaStr);
  const committedVersion = committedSchema.definitions?.UISchema?.properties?.schemaVersion?.default ?? '0.0.0';
  const workingVersion = schema.definitions?.UISchema?.properties?.schemaVersion?.default ?? '0.0.0';

  if (canonicalise(committedSchema) !== canonicalise(schema) && committedVersion === workingVersion) {
    console.error('');
    console.error('  ERROR: Schema definitions changed but schemaVersion was not bumped.');
    console.error(`  Current version: ${workingVersion}`);
    console.error('');
    console.error('  Update "schemaVersion" default in UISchema (e.g. 2.3.0 → 2.4.0),');
    console.error('  add a migration entry in SchemaMigrator.cs, and update packages/schemas/CHANGELOG.md.');
    console.error('');
    process.exit(1);
  }
}
