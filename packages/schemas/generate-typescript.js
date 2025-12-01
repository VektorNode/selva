#!/usr/bin/env node

import { compile } from 'json-schema-to-typescript';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  const schemaPath = path.join(__dirname, 'ui-schema.json');
  const outputPath = path.join(__dirname, '../frontend/src/lib/types/generated/schema.ts');

  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

  // Remove the root $ref that causes issues
  delete schema.$ref;

  try {
    const ts = await compile(schema, 'UISchemaRoot', {
      bannerComment:
        '/* eslint-disable */\n/**\n * This file was automatically generated from schemas/ui-schema.json.\n * DO NOT MODIFY IT BY HAND. Instead, modify the source JSON Schema file,\n * and run `npm run generate:ts` in the schemas directory to regenerate this file.\n */\n',
      style: {
        singleQuote: true,
      },
      unreachableDefinitions: true,
      strictIndexSignatures: true,
    });

    // Post-process to remove "referenced by" comments and add type guards
    let output = ts;

    // Remove all "This interface was referenced by..." comment blocks
    const lines = output.split('\n');
    const filtered = [];
    let inReferenceComment = false;
    let commentStartIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check if this line contains the "referenced by" text
      if (line.includes('This interface was referenced by')) {
        inReferenceComment = true;
        // Find where the comment block started
        for (let j = filtered.length - 1; j >= 0; j--) {
          if (filtered[j].trim() === '/**') {
            commentStartIndex = j;
            break;
          }
          if (filtered[j].trim() === '*/') {
            // There's a previous comment block, this is a new one
            commentStartIndex = filtered.length;
            break;
          }
        }
        continue;
      }

      // If we're in a reference comment, skip until we find the closing
      if (inReferenceComment) {
        if (line.trim() === '*/') {
          // Remove the opening /** if we found it
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

    output = filtered.join('\n'); // Add type guards at the end
    const typeGuards = `

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isInputLayoutItem(item: LayoutItem): item is InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem {
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

// Helper type aliases
export type InputLayoutItem = InputNumberLayoutItem | InputTextLayoutItem | InputDropdownLayoutItem | InputCheckboxLayoutItem;
export type OutputLayoutItem = OutputTextLayoutItem | OutputNumberLayoutItem | OutputFileLayoutItem;
export type SupportedTypes = string | number | boolean;
`;

    output += typeGuards;

    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, output);
    console.log(`Generated TypeScript types at: ${outputPath}`);
  } catch (error) {
    console.error('Error generating TypeScript:', error);
    process.exit(1);
  }
}

main();
