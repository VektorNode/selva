#!/usr/bin/env node

import { compile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function generateSchema(schemaFileName, outputFileName, rootTypeName, options = {}) {
  const schemaPath = path.join(__dirname, schemaFileName);
  const outputPath = path.join(__dirname, `../shared/src/lib/types/generated/${outputFileName}`);

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

    fs.writeFileSync(outputPath, output);
    console.log(`Generated TypeScript types at: ${outputPath}`);
  } catch (error) {
    console.error(`Error generating TypeScript for ${schemaFileName}:`, error);
    process.exit(1);
  }
}

async function main() {
  // Generate UI Schema types
  await generateSchema('ui-schema.json', 'schema.ts', 'UISchemaRoot', {
    appendCode: `

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem {
  return item.type === 'input';
}

export function isOutputLayoutItem(item: LayoutItem): item is OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem {
  return item.type === 'output';
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

export function isCheckboxWidget(item: LayoutItem): item is InputCheckboxLayoutItem {
  return item.type === 'input' && item.widgetType === 'checkbox';
}

export function isFileWidget(item: LayoutItem): item is InputFileLayoutItem {
  return item.type === 'input' && item.widgetType === 'file';
}

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem | InputFileLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem;
export type SupportedTypes = string | number | boolean;
`,
  });

  // Generate Preset Schema types
  await generateSchema('preset-schema.json', 'preset.ts', 'ParameterPresetRoot');
}

main();
